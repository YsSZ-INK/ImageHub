import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { rateLimit, clientIp, TRUST_PROXY } from "@/lib/rate-limit";
import { logActivity } from "@/server/audit.service";

// 登录限流：以邮箱为维度做固定窗口计数（成功登录也计数）。
// 10 次/分钟足够正常使用，同时让针对单账号的暴力猜解成本急剧升高。
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 60_000;

// 在邮箱桶之外再加两个桶：
// ① 全局桶（恒启用）：直连部署拿不到可信客户端 IP（见 rate-limit.ts clientIp），用全局桶兜底分布式爆破；
// ② IP 桶（仅 TRUST_PROXY=1 启用）：反代透传真实客户端 IP 后，按来源限制单 IP 的尝试次数。
const LOGIN_GLOBAL_MAX = 300;
const LOGIN_IP_MAX = 30;

// 限流与封禁需要给前端区分文案。若直接抛普通 Error，Auth.js 会归一为
// error=Configuration，前端无法分辨原因（封禁用户会被提示成「密码错误」）。
// 因此用 CredentialsSignin 子类携带 code：登录仍然失败且不建立会话，只是错误码可读。
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
      },
      async authorize(credentials, request) {
        const { email, password } = (credentials ?? {}) as {
          email?: string;
          password?: string;
        };
        if (!email || !password) return null;
        // 三层桶语义独立、互不依赖：并发执行，避免跨地域 Redis 下 3 × RTT 串行叠加
        // ① 全局桶（恒启用）：整站 300 次/分钟，兜底分布式爆破
        // ② IP 桶：仅反代部署（TRUST_PROXY=1）启用——直连时该头由客户端随意伪造，按它计数无意义
        // ③ 邮箱桶：单账号 10 次/分钟
        const ipKey =
          TRUST_PROXY && request ? `login:ip:${clientIp(request as Request)}` : null;
        const checks = [
          rateLimit("login:global", LOGIN_GLOBAL_MAX, LOGIN_WINDOW_MS),
          rateLimit(`login:${email.toLowerCase()}`, LOGIN_MAX, LOGIN_WINDOW_MS),
        ];
        if (ipKey) checks.push(rateLimit(ipKey, LOGIN_IP_MAX, LOGIN_WINDOW_MS));
        const results = await Promise.all(checks);
        if (results.some((r) => !r.success)) throw new LoginBlockedError("rate_limited");
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
          // 随令牌快照会话吊销版本号：改密后 tokenVersion 变更，旧 JWT 自动失效（见 auth.config.ts / session.ts）
          tokenVersion: user.tokenVersion,
        };
      },
    }),
  ],
});
