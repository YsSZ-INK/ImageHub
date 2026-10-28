/**
 * 邮件发送：开发环境直接打印到控制台。
 * 生产可按同样的接口接入 Resend / SMTP（nodemailer）。
 */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    console.log("========== 邮件预览 ==========");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    console.log("==============================");
  }
}

class ResendMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY 未配置");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: "onboarding@resend.dev", to, subject, text }),
    });
    if (!res.ok) throw new Error(`邮件发送失败: ${res.status}`);
  }
}

export const mailer: Mailer = process.env.RESEND_API_KEY
  ? new ResendMailer()
  : new ConsoleMailer();
