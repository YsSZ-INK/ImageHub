import Redis from "ioredis";
import { getSettings } from "@/lib/settings";

/**
 * Redis 连接管理（可选组件，全程可降级）：
 * - 启用开关：站点设置 redisEnabled=false 时不连（限流走进程内存），随时切换无需重启
 * - 连接地址：站点设置 redisUrl 优先，环境变量 REDIS_URL 兜底（Docker 部署可指向同栈 redis 容器）
 * - 惰性连接：仅在首次使用时建立；站点设置修改 URL 后自动重建
 * - 故障降级：连接失败 / 命令异常时返回 null，调用方回退进程内存实现，不影响主功能
 */

type RedisState = {
  status: "disabled" | "connected" | "error";
  url: string; // 脱敏展示（隐藏密码）
  error: string;
  since: string; // 状态更新时间
};

const state: RedisState = { status: "disabled", url: "", error: "", since: "" };

let client: Redis | null = null;
let clientUrl = "";
let connecting: Promise<Redis | null> | null = null;

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

function updateState(status: RedisState["status"], error = "") {
  state.status = status;
  state.error = error;
  state.since = new Date().toISOString();
}

// 关闭当前连接（URL 变更 / 未配置 / 重建前调用）
function destroy() {
  if (client) {
    client.disconnect();
    client = null;
    clientUrl = "";
  }
}

async function resolveUrl(): Promise<string> {
  try {
    // 开关关闭：完全不连 Redis（限流降级进程内存）
    const settings = await getSettings();
    if (!settings.redisEnabled) return "";
    if (settings.redisUrl.trim()) return settings.redisUrl.trim();
  } catch {
    // 设置读取失败时退环境变量判断
  }
  return process.env.REDIS_URL?.trim() || "";
}

async function doGet(): Promise<Redis | null> {
  const url = await resolveUrl();
  state.url = url ? maskUrl(url) : "";
  if (!url) {
    destroy();
    updateState("disabled");
    return null;
  }
  // 同 URL 且连接健康：直接复用
  if (client && clientUrl === url && client.status === "ready") return client;
  // URL 变更或连接失效：重建
  destroy();
  const c = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // 不自动重连：失败即降级内存，下次调用再重建，避免坏 URL 下的无限重试
    retryStrategy: () => null,
  });
  c.on("error", () => {}); // 吞掉 error 事件防止未捕获异常
  clientUrl = url;
  client = c;
  try {
    await c.connect();
    updateState("connected");
    return c;
  } catch (err) {
    updateState("error", err instanceof Error ? err.message : String(err));
    destroy();
    return null;
  }
}

// 获取可用 Redis 客户端；未配置 / 连接失败返回 null（调用方回退内存实现）
export async function getRedis(): Promise<Redis | null> {
  // 单例 Promise 防并发下重复建连
  connecting ??= doGet().finally(() => {
    connecting = null;
  });
  return connecting;
}

// 站点设置页展示当前连接状态
export function redisStatus(): RedisState {
  return { ...state };
}

// 测试连接（不改动当前连接）：用传入 URL 真实 PING 一次，成功后立即断开
export async function testRedisUrl(url: string): Promise<{ ok: boolean; message: string }> {
  if (!/^rediss?:\/\//.test(url)) return { ok: false, message: "地址需以 redis:// 或 rediss:// 开头" };
  const c = new Redis(url, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
  c.on("error", () => {});
  try {
    await c.connect();
    const pong = await c.ping();
    return { ok: pong === "PONG", message: pong === "PONG" ? "连接成功" : `异常响应：${pong}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    c.disconnect();
  }
}
