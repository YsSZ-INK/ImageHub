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

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
