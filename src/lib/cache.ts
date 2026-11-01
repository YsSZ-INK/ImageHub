import { getRedis } from "@/lib/redis";

/**
 * 通用 cache-aside 缓存助手（可选组件，全程可降级）：
 * - Redis 可用：数据存 Redis（跨进程/重启共享），由 Redis TTL 自动过期
 * - Redis 未配置或故障：降级进程内存 Map（带 TTL，条目数上限防膨胀）
 * - loader 返回 undefined 表示「结果不适合缓存」（如非公开图片），调用方每次实时计算
 * - 变更入口用 invalidateJson 主动失效，配合短 TTL 双保险
 */

type MemEntry = { value: string; expiresAt: number };
const MEM_LIMIT = 1000;
const mem = new Map<string, MemEntry>();

function memGet(key: string): string | undefined {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.expiresAt <= Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return e.value;
}

function memSet(key: string, value: string, ttlMs: number) {
  if (mem.size >= MEM_LIMIT) {
    // 先清过期项；仍满则丢最旧（Map 保持插入序）
    const now = Date.now();
    for (const [k, v] of mem) if (v.expiresAt <= now) mem.delete(k);
    if (mem.size >= MEM_LIMIT) {
      const oldest = mem.keys().next().value;
      if (oldest) mem.delete(oldest);
    }
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// 读缓存：命中返回反序列化结果；未命中跑 loader 并写缓存（loader 返回 undefined 则跳过缓存）
export async function cachedJson<T>(key: string, ttlMs: number, loader: () => Promise<T | undefined>): Promise<T | undefined> {
  let raw: string | undefined;
  const r = await getRedis();
  if (r) {
    try {
      raw = (await r.get(key)) ?? undefined;
    } catch {
      raw = undefined; // Redis 异常时降级内存
    }
  }
  if (raw === undefined) raw = memGet(key);
  if (raw !== undefined) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 缓存内容损坏视为未命中
    }
  }

  const value = await loader();
  if (value === undefined) return undefined; // 不适合缓存，直接返回
  const payload = JSON.stringify(value);
  if (r) {
    try {
      await r.set(key, payload, "PX", ttlMs);
    } catch {
      // 写失败不致命（内存兜底 + 下次重试）
    }
  }
  memSet(key, payload, ttlMs);
  return value;
}

// 主动失效（Redis DEL + 内存清除）：图片行 / 授权关系等变更入口调用
export async function invalidateJson(...keys: string[]) {
  if (keys.length === 0) return;
  const r = await getRedis();
  if (r) {
    try {
      await r.del(...keys);
    } catch {
      // 忽略，TTL 兜底
    }
  }
  for (const k of keys) mem.delete(k);
}
