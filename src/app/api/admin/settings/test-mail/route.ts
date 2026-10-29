import { handle, assertSameOrigin, ok, fail, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getMailer } from "@/lib/mailer";

export const runtime = "nodejs";

// 发送测试邮件：收件人为当前管理员的邮箱；需先保存 SMTP 配置
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);

  const settings = await getSettings();
  if (!settings.smtpHost) {
    return fail("请先填写 SMTP 服务器并保存配置");
  }
  try {
    const mailer = await getMailer();
    await mailer.send(
      viewer.email,
      "ImageHub 测试邮件",
      `这是一封来自 ${settings.siteName} 的测试邮件，收到即说明 SMTP 配置生效。`
    );
    return ok({ message: `测试邮件已发送至 ${viewer.email}，请查收` });
  } catch (err) {
    // 把 SMTP 的真实报错（认证失败 / 连接超时等）透传给管理员
    console.error("[test-mail]", err);
    return fail(`发送失败：${err instanceof Error ? err.message : "未知错误"}`, 502);
  }
});
