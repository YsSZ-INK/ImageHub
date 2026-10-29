import nodemailer from "nodemailer";
import { getSettings } from "@/lib/settings";

/**
 * 邮件发送：后台「站点设置 → 邮件配置」填了 SMTP 就走 SMTP；
 * 未配置时回退为控制台打印（开发环境无需真实邮箱）。
 */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    console.log("========== 邮件预览（未配置 SMTP，仅打印） ==========");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
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
