import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { redisStatus, testRedisUrl, getRedis } from "@/lib/redis";
import { getSettings } from "@/lib/settings";
import { z } from "zod";

export const runtime = "nodejs";

// 当前 Redis 连接状态（含站点设置里的启用开关状态）
export const GET = handle(async () => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const settings = await getSettings();
  return ok({ ...redisStatus(), enabled: settings.redisEnabled });
});

const bodySchema = z.object({ url: z.string().max(255).trim().optional() });

// 测试连接：带 url 测表单值（保存前验证）；不带则对当前生效配置 PING 一次
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { url } = bodySchema.parse(await req.json().catch(() => ({})));
  if (url !== undefined && url !== "") {
    const r = await testRedisUrl(url);
    return ok(r);
  }
  const c = await getRedis();
  if (!c) {
    const settings = await getSettings();
    const s = redisStatus();
    return ok({
      ok: false,
      message: !settings.redisEnabled
        ? "Redis 开关未启用（限流走进程内存）"
        : s.status === "disabled"
          ? "未配置连接地址（限流走进程内存）"
          : `连接失败：${s.error}`,
    });
  }
  const pong = await c.ping();
  return ok({ ok: pong === "PONG", message: pong === "PONG" ? "连接成功，限流已走 Redis" : `异常响应：${pong}` });
});
