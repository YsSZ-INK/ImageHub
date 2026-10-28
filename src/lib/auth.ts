import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";

// 完整 NextAuth 实例（Node 运行时）：Credentials 登录 + JWT 会话
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
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
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        if (user.status === "BANNED") {
          // 抛错携带文案，登录页展示
          throw new Error("账号已被封禁，请联系管理员");
        }
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
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
