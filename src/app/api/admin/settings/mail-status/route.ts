import { handle, ok } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { verifySmtp } from "@/lib/mailer";

export const runtime = "nodejs";

// 邮件配置当前连接状态：真实连接 + 认证握手（不发信）。
// SMTP 本身无常驻连接，状态为即时探测结果——打开设置页、保存配置、点「检测连接」时刷新，
// 用于发现首次配置成功后因密码被改、服务商封禁等问题导致的失效。
export const GET = handle(async () => {
  await requireApiSuper();
  const s = await getSettings();
  if (!s.smtpHost) return ok({ status: "unconfigured", host: "" });
  const r = await verifySmtp(s);
  return ok(r.ok ? { status: "connected", host: s.smtpHost } : { status: "error", host: s.smtpHost, error: r.error });
});
