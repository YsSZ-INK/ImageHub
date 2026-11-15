import { getRedis } from "@/lib/redis";

/**
 * 限流：固定窗口计数。
 * - 站点设置/环境变量配置了 Redis 时用 Redis（Lua 原子完成 INCR+PEXPIRE+PTTL，一次往返）
 * - 未配置或 Redis 故障时自动降级为进程内存实现（单实例适用，重启清零）
 */
type Counter = { count: number; resetAt: number };

const memory = new Map<string, Counter>();

// 计数 + 过期 + 读剩余 TTL 合成一次 EVAL：TTL 依赖 INCR 结果，必须原子，
// 跨地域 Redis 下单条命令就是 1 个 RTT，拆成三条会放大成 2~3 个 RTT。
const LIMIT_LUA = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}
`;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; retryAfter: number }> {
  // 按 key 选实例：同一限流键必须固定落同一台，否则计数会被节点数放大
  const k = `rl:${key}`;
  const r = await getRedis(k);
  if (r) {
    try {
      const res = (await r.eval(LIMIT_LUA, 1, k, String(windowMs))) as [number, number];
      const n = Number(res?.[0] ?? 0);
      const ttl = Number(res?.[1] ?? windowMs);
      return { success: n <= limit, retryAfter: Math.ceil(Math.max(ttl, 0) / 1000) };
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

// 取客户端 IP。
// 直连部署（无反代）时 X-Forwarded-For / X-Real-IP 由客户端随意伪造（实测可轮换绕过限流），
// 因此默认不信任任何代理头、退化为全局键（fail-closed，全站共享限流窗口，个人站足够）；
// 部署在 nginx 等反代之后时设置环境变量 TRUST_PROXY=1，此时优先取反代写入的 X-Real-IP，
// 其次取 X-Forwarded-For 最右一跳（最近的可信代理写入的值），并建议反代配置
// `proxy_set_header X-Real-IP $remote_addr;` 以获得按 IP 的精细限流。
export const TRUST_PROXY = process.env.TRUST_PROXY === "1";

// TRUST_PROXY=1 时，反代写入的取值也须「形似 IP」才采信，
// 避免反代配置疏漏时把任意垃圾头当成限流键；IPv4 点分十进制 / IPv6 冒号十六进制简单形似即可。
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){1,7}$/;

function looksLikeIp(v: string): boolean {
  return IPV4_RE.test(v) || IPV6_RE.test(v);
}

export function clientIp(req: Request): string {
  if (!TRUST_PROXY) return "direct";
  const rip = req.headers.get("x-real-ip");
  if (rip && looksLikeIp(rip.trim())) return rip.trim();
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && looksLikeIp(last)) return last;
  }
  return "unknown";
}
