import nodemailer from "nodemailer";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * 邮件发送：后台「站点设置 → 邮件配置」填了 SMTP 就走 SMTP；
 * 未配置时回退为控制台打印（开发环境无需真实邮箱）。
 */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    // 生产环境的控制台日志通常被容器/日志系统留存，验证/重置链接里的 token
    // 打进日志等于把一次性凭据交给所有能看日志的人，因此生产打印前脱敏
    // （开发环境照旧完整输出，便于调试）。
    const safe =
      process.env.NODE_ENV === "production"
        ? text.replace(/token=([0-9a-f]{16,})/gi, "token=<已隐藏>")
        : text;
    console.log("========== 邮件预览（未配置 SMTP，仅打印） ==========");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(safe);
    console.log("====================================================");
  }
}

class SmtpMailer implements Mailer {
  constructor(
    private host: string,
    private port: number,
    private secure: boolean,
    private user: string,
    private pass: string,
    private from: string
  ) {}

  async send(to: string, subject: string, text: string) {
    const transport = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: this.secure,
      auth: this.user ? { user: this.user, pass: this.pass } : undefined,
      // SMTP 地址不可达时默认会挂很久，导致「发送测试邮件」按钮长时间转圈；
      // 限定连接/握手/读写超时，失败快速返回给前端提示
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({ from: this.from || this.user, to, subject, text });
  }
}

export async function getMailer(): Promise<Mailer> {
  const s = await getSettings();
  if (s.smtpHost) {
    return new SmtpMailer(s.smtpHost, s.smtpPort || 587, s.smtpSecure, s.smtpUser, s.smtpPass, s.smtpFrom);
  }
  return new ConsoleMailer();
}

/**
 * 邮件通知管理员（站点事件用）。按角色分层收件：
 * - 默认 ["ADMIN", "SUPERADMIN"]：业务类（待审核申请等），两级管理员都收
 * - ["SUPERADMIN"]：基础设施类（存储降级、付费/配置问题），只发超级管理员
 * 内部自捕获所有异常：邮件失败绝不影响主流程，调用方可用 void 直接触发。
 */
export async function notifyAdmins(
  subject: string,
  text: string,
  roles: ("ADMIN" | "SUPERADMIN")[] = ["ADMIN", "SUPERADMIN"]
): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: roles }, status: "ACTIVE" },
      select: { email: true },
    });
    if (admins.length === 0) return;
    const mailer = await getMailer();
    for (const a of admins) {
      await mailer.send(a.email, subject, text).catch((e) => console.error("[mail] 管理员通知发送失败:", e));
    }
  } catch (e) {
    console.error("[mail] 管理员通知失败:", e);
  }
}

/** 只通知超级管理员（基础设施类事件） */
export async function notifySupers(subject: string, text: string): Promise<void> {
  return notifyAdmins(subject, text, ["SUPERADMIN"]);
}

/** 邮件通知指定用户（查看申请被发起时通知被申请人等）；同样自捕获异常 */
export async function notifyUserById(userId: string, subject: string, text: string): Promise<void> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
    if (!u || u.status !== "ACTIVE") return;
    await (await getMailer()).send(u.email, subject, text);
  } catch (e) {
    console.error("[mail] 用户通知失败:", e);
  }
}
