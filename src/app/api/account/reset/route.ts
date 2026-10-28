import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requestResetSchema, resetPasswordSchema } from "@/lib/validation";
import { requestPasswordReset, resetPassword } from "@/server/user.service";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 请求重置密码（匿名，IP 限流）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const rl = await rateLimit(`reset:${clientIp(req)}`, 5, 300_000);
  if (!rl.success) throw new AppError("操作过于频繁", 429);
  const input = requestResetSchema.parse(await req.json());
  await requestPasswordReset(input);
  // 静默成功，避免邮箱枚举
  return ok({ message: "如邮箱存在，重置链接已发送（开发环境查看服务端控制台）" });
});

// 执行重置（匿名）
export const PUT = handle(async (req: Request) => {
  assertSameOrigin(req);
  const rl = await rateLimit(`reset-do:${clientIp(req)}`, 5, 300_000);
  if (!rl.success) throw new AppError("操作过于频繁", 429);
  const input = resetPasswordSchema.parse(await req.json());
  await resetPassword(input);
  return ok({ message: "密码已重置，请使用新密码登录" });
});
