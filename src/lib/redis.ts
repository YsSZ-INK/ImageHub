import Redis from "ioredis";
import { getSettings } from "@/lib/settings";

/**
 * Redis 连接管理（可选组件，全程可降级）：
 * - 启用开关：站点设置 redisEnabled=false 时不连（限流走进程内存），随时切换无需重启
 * - 多地址：站点设置 redisSlots 优先，环境变量 REDIS_URL 兜底（支持逗号分隔多个地址）
 * - 两种模式：
 *   failover 主备切换 —— 按列表顺序只连到第一个可用地址，全部读写都走它
 *   balance  同时读写 —— 所有健康地址都连上，按 key 做 rendezvous 哈希分担（同一 key 固定落同一实例）
 * - 惰性连接：仅在首次使用时建立；配置变更后自动重建
 * - 故障降级：地址失败进入 30s 冷却，下次调用再探测；全部不可用时返回 null，调用方回退进程内存
 */

export type RedisMode = "failover" | "balance";

export type RedisSlotState = {
  index: number;
  label: string;
  url: string; // 已脱敏
  status: "connected" | "standby" | "error" | "cooldown" | "idle";
  error: string;
  since: string;
  // PING 往返耗时（毫秒）：null 表示未测 / 当前不可用；0 表示小于 1ms
  latencyMs: number | null;
};

export type RedisState = {
  status: "disabled" | "connected" | "error";
  url: string; // 主备模式为当前生效地址（脱敏）；同时读写模式为空
  error: string;
  since: string;
  activeIndex: number; // 主备模式当前生效下标，-1 表示无可用
  mode: RedisMode;
  // 总体延迟：主备为生效节点延迟，同时读写为各健康节点平均延迟；null 表示不可用
  latencyMs: number | null;
  slots: RedisSlotState[];
};

const CONNECT_TIMEOUT_MS = 3000;
const COOLDOWN_MS = 30_000;

// 模块级单例：连接池与状态都挂在模块上，不放进 React state
const clients = new Map<string, Redis>();
const cooldownUntil = new Map<string, number>();
const slotError = new Map<string, string>();
let lastSlots: { url: string; label: string }[] = [];
let preparing: Promise<void> | null = null;
let roundRobin = 0;

const state: RedisState = { status: "disabled", url: "", error: "", since: "", activeIndex: -1, mode: "failover", latencyMs: null, slots: [] };

// 脱敏展示（隐藏密码）
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username && u.username !== "default") u.username = "***";
    return u.toString();
  } catch {
    return url.replace(/\/\/[^@/]+@/, "//***@");
  }
}

// 把 ioredis 的英文错误转成可读中文（设置页直接展示）
export function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("econnrefused")) return "连接被拒绝（Redis 未启动或端口不通）";
  if (m.includes("enotfound") || m.includes("getaddrinfo")) return "域名解析失败（主机地址有误）";
  if (m.includes("etimedout") || m.includes("timeout")) return "连接超时（网络不通或被防火墙拦截）";
  if (m.includes("wrongpass") || m.includes("invalid password")) return "密码错误（认证失败）";
  if (m.includes("noauth")) return "需要密码（未提供认证信息）";
  if (m.includes("connection is closed")) return "连接已断开";
  if (m.includes("econnreset")) return "连接被重置";
  return msg;
}

// rendezvous 哈希：同一 key 固定落同一实例；增删节点时只影响该节点上的 key
function hashScore(key: string, url: string): number {
  const str = `${key}@${url}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// 按 key 选实例：failover 固定第一个健康节点；balance 无 key 时轮询，有 key 时哈希
function selectClient(key?: string): Redis | null {
  const healthy = lastSlots.filter((s) => clients.get(s.url)?.status === "ready");
  if (healthy.length === 0) return null;
  if (state.mode === "failover") return clients.get(healthy[0].url) ?? null;
  if (!key) return clients.get(healthy[roundRobin++ % healthy.length].url) ?? null;
  let bestUrl = healthy[0].url;
  let best = -1;
  for (const s of healthy) {
    const score = hashScore(key, s.url);
    if (score > best) {
      best = score;
      bestUrl = s.url;
    }
  }
  return clients.get(bestUrl) ?? null;
}

// 建连参数：不自动重连、不排队，坏地址不会让每个请求都卡 3 秒
function createClient(url: string): Redis {
  const c = new Redis(url, {
    lazyConnect: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    // 同一 tick 内的多条命令合并成一次往返（登录三层限流等场景直接省掉 N-1 个 RTT）。
    // 仅对单机/哨兵有效：本项目的多地址是独立实例分别建连，不涉及 Cluster，可安全开启。
    enableAutoPipelining: true,
    // 连接假死（半开 TCP）时不让请求无限挂住，超时后走内存降级
    commandTimeout: 2000,
  });
  c.on("error", () => {}); // 必须吞掉 error 事件，否则未捕获异常刷屏
  return c;
}

// 读配置：站点槽位 > 旧单地址字段 > 环境变量；开关关闭时连环境变量也不生效
async function resolveConfig(): Promise<{ mode: RedisMode; slots: { url: string; label: string }[] }> {
  let mode: RedisMode = "failover";
  let urls: string[] = [];
  let labels: string[] = [];
  try {
    const s = await getSettings();
    mode = s.redisMode;
    if (!s.redisEnabled) return { mode, slots: [] };
    const slots = s.redisSlots.filter((x) => x.url.trim());
    if (slots.length) {
      urls = slots.map((x) => x.url.trim());
      labels = slots.map((x) => (x.label ?? "").trim());
    } else if (s.redisUrl.trim()) {
      urls = [s.redisUrl.trim()];
      labels = [""];
    }
  } catch {
    // 设置读取失败：退环境变量（Redis 属可选组件，读不到设置也要能工作）
  }
  if (urls.length === 0) {
    urls = (process.env.REDIS_URL ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    labels = urls.map(() => "");
  }
  // 去重并生成默认 label（主备：主 / 备 N；同时读写：节点 N）
  const seen = new Set<string>();
  const out: { url: string; label: string }[] = [];
  urls.forEach((u, i) => {
    if (seen.has(u)) return;
    seen.add(u);
    const fallback = mode === "failover" ? (out.length === 0 ? "主" : `备 ${out.length}`) : `节点 ${out.length + 1}`;
    out.push({ url: u, label: labels[i] || fallback });
  });
  return { mode, slots: out };
}

// 确保单个地址已连接；冷却期内直接失败，避免坏地址拖慢每个请求
async function ensureSlot(url: string): Promise<boolean> {
  const existing = clients.get(url);
  if (existing?.status === "ready") return true;
  if (existing) {
    existing.disconnect();
    clients.delete(url);
  }
  const until = cooldownUntil.get(url) ?? 0;
  if (until > Date.now()) return false;
  const c = createClient(url);
  clients.set(url, c);
  try {
    await c.connect();
    cooldownUntil.delete(url);
    slotError.delete(url);
    return true;
  } catch (err) {
    cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
    slotError.set(url, friendlyError(err instanceof Error ? err.message : String(err)));
    try {
      c.disconnect();
    } catch {
      // 忽略
    }
    clients.delete(url);
    return false;
  }
}

// 主备顺序连（第一个成功即停）；同时读写并行全连
async function ensureConnections(mode: RedisMode, slots: { url: string }[]): Promise<void> {
  if (mode === "failover") {
    for (const s of slots) {
      if (await ensureSlot(s.url)) break;
    }
    return;
  }
  await Promise.all(slots.map((s) => ensureSlot(s.url)));
}

// 把连接池真实状态写回 state（供设置页展示）
function refreshState(mode: RedisMode, slots: { url: string; label: string }[]): void {
  const readyIndexes: number[] = [];
  const now = new Date().toISOString();
  const slotStates: RedisSlotState[] = slots.map((s, index) => {
    const c = clients.get(s.url);
    const cooling = (cooldownUntil.get(s.url) ?? 0) > Date.now();
    let status: RedisSlotState["status"] = "idle";
    if (c?.status === "ready") {
      readyIndexes.push(index);
      status = "connected";
    } else if (cooling) {
      status = "cooldown";
    } else if (slotError.has(s.url)) {
      status = "error";
    }
    return {
      index,
      label: s.label,
      url: maskUrl(s.url),
      status,
      error: slotError.get(s.url) ?? "",
      since: now,
      // 保留上一次测得的延迟；连接不可用时清空，避免展示过期数据
      latencyMs: readyIndexes.includes(index) ? (state.slots[index]?.latencyMs ?? null) : null,
    };
  });
  // 主备模式的生效下标是第一个健康节点；其余健康节点标为备用
  const activeIndex = mode === "failover" ? (readyIndexes.length ? readyIndexes[0] : -1) : -1;
  if (mode === "failover") {
    for (const st of slotStates) {
      if (st.status === "connected" && st.index !== activeIndex) st.status = "standby";
    }
  }
  const status: RedisState["status"] = slots.length === 0 ? "disabled" : readyIndexes.length ? "connected" : "error";
  const error = status === "error" ? slotStates[0]?.error || "全部地址连接失败" : "";
  const changed = state.status !== status || state.error !== error || state.mode !== mode;
  state.mode = mode;
  state.slots = slotStates;
  state.activeIndex = activeIndex;
  state.url = mode === "failover" && activeIndex >= 0 ? slotStates[activeIndex]?.url ?? "" : "";
  state.status = status;
  state.error = error;
  // 总体延迟：主备取生效节点，同时读写取健康节点平均
  if (status !== "connected") state.latencyMs = null;
  else if (mode === "failover") state.latencyMs = slotStates[activeIndex]?.latencyMs ?? null;
  else {
    const vals = slotStates.filter((s) => s.status === "connected" && s.latencyMs != null).map((s) => s.latencyMs as number);
    state.latencyMs = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  state.since = changed || !state.since ? now : state.since;
}

/**
 * 实测各健康节点的 PING 往返耗时（毫秒）。
 * 只在后台设置页读取 / 测试时调用——正常读写路径不做额外 PING，避免每次请求多一个 RTT。
 */
export async function refreshLatency(): Promise<void> {
  const results = await Promise.all(
    lastSlots.map(async (s) => {
      const c = clients.get(s.url);
      if (c?.status !== "ready") return null;
      const t0 = performance.now();
      try {
        const pong = await c.ping();
        return pong === "PONG" ? Math.max(0, Math.round(performance.now() - t0)) : null;
      } catch {
        return null;
      }
    })
  );
  let sum = 0;
  let count = 0;
  results.forEach((ms, i) => {
    const slot = state.slots[i];
    if (!slot) return;
    if (slot.status !== "connected" && slot.status !== "standby") slot.latencyMs = null;
    else slot.latencyMs = ms;
    if (ms != null) {
      sum += ms;
      count++;
    }
  });
  if (state.status !== "connected") state.latencyMs = null;
  else if (state.mode === "failover") state.latencyMs = results[state.activeIndex] ?? null;
  else state.latencyMs = count ? Math.round(sum / count) : null;
}

// 准备连接：解析配置 → 关掉已移除的连接 → 建连 → 刷新状态
async function prepare(): Promise<void> {
  const { mode, slots } = await resolveConfig();
  lastSlots = slots;
  state.mode = mode;
  if (slots.length === 0) {
    for (const c of clients.values()) c.disconnect();
    clients.clear();
    cooldownUntil.clear();
    slotError.clear();
    state.status = "disabled";
    state.url = "";
    state.error = "";
    state.activeIndex = -1;
    state.latencyMs = null;
    state.slots = [];
    state.since = new Date().toISOString();
    return;
  }
  // 配置里已删除的地址：断开并清理状态
  const keep = new Set(slots.map((s) => s.url));
  for (const [url, c] of clients) {
    if (keep.has(url)) continue;
    c.disconnect();
    clients.delete(url);
    cooldownUntil.delete(url);
    slotError.delete(url);
  }
  await ensureConnections(mode, slots);
  refreshState(mode, slots);
}

// 获取可用 Redis 客户端；未配置 / 连接失败返回 null（调用方回退内存实现）
// 带 key 时按 key 选实例，保证同一 key 的读写落在同一台
export async function getRedis(key?: string): Promise<Redis | null> {
  if (!preparing) {
    preparing = prepare()
      .catch(() => {
        // 配置解析或建连异常不应影响主功能
      })
      .finally(() => {
        preparing = null;
      });
  }
  await preparing;
  return selectClient(key);
}

// 所有健康客户端（缓存失效要对全节点 DEL 时用）
export function getRedisNodes(): Redis[] {
  const out: Redis[] = [];
  for (const s of lastSlots) {
    const c = clients.get(s.url);
    if (c?.status === "ready") out.push(c);
  }
  return out;
}

// 站点设置页展示当前连接状态（深拷贝，避免外部改到内部状态）
export function redisStatus(): RedisState {
  return { ...state, slots: state.slots.map((s) => ({ ...s })) };
}

// 测试连接（不改动当前连接池）：用传入地址真实 PING 一次后断开
export async function testRedisUrl(url: string): Promise<{ ok: boolean; message: string }> {
  if (!/^rediss?:\/\//.test(url)) return { ok: false, message: "地址需以 redis:// 或 rediss:// 开头" };
  const c = createClient(url);
  try {
    await c.connect();
    const pong = await c.ping();
    return { ok: pong === "PONG", message: pong === "PONG" ? "连接成功" : `异常响应：${pong}` };
  } catch (err) {
    return { ok: false, message: friendlyError(err instanceof Error ? err.message : String(err)) };
  } finally {
    c.disconnect();
  }
}

// 保存配置后调用：清空冷却与错误记录，让下次探测立即重试
export function resetRedisCooldown(): void {
  cooldownUntil.clear();
  slotError.clear();
  for (const s of state.slots) {
    if (s.status === "error" || s.status === "cooldown") {
      s.status = "idle";
      s.error = "";
    }
  }
}
