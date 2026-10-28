/**
 * 限流：Redis 可选，未配置 REDIS_URL 时降级为进程内存实现。
 * 令牌桶：window 窗口内最多 limit 次。
 */
type Counter = { count: number; resetAt: number };

const memory = new Map<string, Counter>();

// 惰性加载 ioredis，避免未配置 Redis 时引入开销
type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
};
let redis: RedisLike | null | undefined;

async function getRedis(): Promise<RedisLike | null> {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    redis = null;
    return null;
  }
  try {
    const { default: Redis } = await import("ioredis");
    redis = new Redis(url) as unknown as RedisLike;
  } catch (e) {
    console.warn("[rate-limit] Redis 初始化失败，降级为内存实现", e);
    redis = null;
  }
  return redis;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; retryAfter: number }> {
  const r = await getRedis();
  if (r) {
    const k = `rl:${key}`;
    const count = await r.incr(k);
    if (count === 1) await r.pexpire(k, windowMs);
    const ttl = await r.pttl(k);
    return {
      success: count <= limit,
      retryAfter: ttl > 0 ? Math.ceil(ttl / 1000) : Math.ceil(windowMs / 1000),
    };
  }
  // 内存实现
  const now = Date.now();
  const c = memory.get(key);
  if (!c || c.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, retryAfter: Math.ceil(windowMs / 1000) };
  }
  c.count += 1;
  return {
    success: c.count <= limit,
    retryAfter: Math.ceil((c.resetAt - now) / 1000),
  };
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
