import { getRedis } from "@/lib/redis";

/**
 * 限流：固定窗口计数。
 * - 站点设置/环境变量配置了 Redis 时用 Redis INCR+PEXPIRE（多实例共享、重启不清零）
 * - 未配置或 Redis 故障时自动降级为进程内存实现（单实例适用，重启清零）
 */
type Counter = { count: number; resetAt: number };

const memory = new Map<string, Counter>();

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; retryAfter: number }> {
  const r = await getRedis();
  if (r) {
    try {
      const k = `rl:${key}`;
      const n = await r.incr(k);
      if (n === 1) await r.pexpire(k, windowMs);
      let ttl = await r.pttl(k);
      if (ttl < 0) {
        // 键无过期（如 Redis 重启前残留）：补上过期时间
        await r.pexpire(k, windowMs);
        ttl = windowMs;
      }
      return { success: n <= limit, retryAfter: Math.ceil(ttl / 1000) };
    } catch {
      // Redis 异常：降级到内存限流
    }
  }

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

// 安全员（渗透测试修复）：取客户端 IP。
// 直连部署（无反代）时 X-Forwarded-For / X-Real-IP 均由客户端随意伪造（实测可轮换绕过限流），
// 因此默认不信任任何代理头、退化为全局键（fail-closed，全站共享限流窗口，个人站足够）；
// 部署在 nginx 等反代之后时设置环境变量 TRUST_PROXY=1，此时优先取反代写入的 X-Real-IP，
// 其次取 X-Forwarded-For 最右一跳（最近的可信代理写入的值），并建议反代配置
// `proxy_set_header X-Real-IP $remote_addr;` 以获得按 IP 的精细限流。
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

export function clientIp(req: Request): string {
  if (!TRUST_PROXY) return "direct";
  const rip = req.headers.get("x-real-ip");
  if (rip && rip.trim()) return rip.trim();
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}
