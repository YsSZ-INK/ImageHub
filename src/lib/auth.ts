import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/server/audit.service";

// 安全员（渗透测试修复）：登录接口原本无任何限流，可对单账号无限暴力猜解。
// 以邮箱维度做固定窗口限流（成功登录也计数，10 次/分钟足够正常使用）。
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 60_000;

// 安全员（渗透测试修复）：限流/封禁需要给前端区分文案。authorize 抛普通 Error 会被
// Auth.js 归一为 error=Configuration，前端无从分辨（封禁用户会误看到「密码错误」）。
// 改用 CredentialsSignin 子类携带 code，客户端 signIn 返回值里 code 原样可达，
// 登录依然失败（不带会话），仅文案可区分。
class LoginBlockedError extends CredentialsSignin {
  code: string;
  constructor(code: string) {
    super();
    this.code = code;
  }
}

// 完整 NextAuth 实例（Node 运行时）：Credentials 登录 + JWT 会话
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt", maxAge: 3 * 24 * 3600 },
  providers: [
    Credentials({
      name: "邮箱密码登录",
      credentials: {
        email: { label: "邮箱" },
        password: { label: "密码" },
        remember: { label: "记住我" },
      },
      async authorize(credentials) {
        const { email, password, remember } = (credentials ?? {}) as {
          email?: string;
          password?: string;
          remember?: boolean | string;
        };
        if (!email || !password) return null;
        const rl = await rateLimit(`login:${email.toLowerCase()}`, LOGIN_MAX, LOGIN_WINDOW_MS);
        if (!rl.success) throw new LoginBlockedError("rate_limited");
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        if (user.status === "BANNED") {
          throw new LoginBlockedError("banned");
        }
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        await logActivity(user.id, "login", "登录了站点");
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          remember: remember === true || remember === "true",
        };
      },
    }),
  ],
});
