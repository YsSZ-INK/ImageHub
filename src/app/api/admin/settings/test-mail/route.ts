import { handle, assertSameOrigin, ok, fail } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getMailer } from "@/lib/mailer";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 发送测试邮件：固定发到全部超级管理员邮箱（配置类验证归超管）；需先保存 SMTP 配置
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await requireApiSuper();

  const settings = await getSettings();
  if (!settings.smtpHost) {
    return fail("请先填写 SMTP 服务器并保存配置");
  }
  const supers = await prisma.user.findMany({
    where: { role: "SUPERADMIN", status: "ACTIVE" },
    select: { email: true },
  });
  if (supers.length === 0) return fail("没有可用的超级管理员邮箱");
  try {
    const mailer = await getMailer();
    for (const s of supers) {
      await mailer.send(
        s.email,
        "ImageHub 测试邮件",
        `这是一封来自 ${settings.siteName} 的测试邮件，收到即说明 SMTP 配置生效。`
      );
    }
    const list = supers.map((s) => s.email).join("、");
    return ok({ message: `测试邮件已发送至超级管理员邮箱（${list}），请查收` });
  } catch (err) {
    // 把 SMTP 的真实报错（认证失败 / 连接超时等）透传给管理员
    console.error("[test-mail]", err);
    return fail(`发送失败：${err instanceof Error ? err.message : "未知错误"}`, 502);
  }
});
