import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser, getCurrentUser } from "@/lib/session";
import { sendVerifyEmail, verifyEmail } from "@/server/user.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 发送验证邮件（需登录）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const rl = await rateLimit(`verify:${user.id}`, 3, 300_000);
  if (!rl.success) throw new AppError("发送过于频繁，请稍后再试", 429);
  await sendVerifyEmail(user);
  return ok({ message: "验证邮件已发送（开发环境查看服务端控制台）" });
});

// 通过链接验证邮箱（匿名可访问）
export const PUT = handle(async (req: Request) => {
  const { token } = (await req.json()) as { token?: string };
  if (!token) throw new AppError("缺少 token", 400);
  await verifyEmail(token);
  return ok({ message: "邮箱验证成功" });
});

// 查询当前验证状态
export const GET = handle(async () => {
  const user = await getCurrentUser();
  return ok({ verified: !!user?.emailVerified });
});
