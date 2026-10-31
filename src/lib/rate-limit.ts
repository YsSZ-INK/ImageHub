/**
 * 限流：进程内存实现（固定窗口计数）。
 * 单实例部署适用；实例重启后计数清零。
 */
type Counter = { count: number; resetAt: number };

const memory = new Map<string, Counter>();

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; retryAfter: number }> {
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
