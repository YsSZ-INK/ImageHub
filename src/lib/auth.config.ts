import type { NextAuthConfig } from "next-auth";

// 边缘安全配置：不含 Prisma，供 middleware 使用
export const authConfig = {
  pages: { signIn: "/" },
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [], // 凭证 Provider 在 lib/auth.ts（Node 运行时）中注册
  callbacks: {
    // 登录成功后把 id / role 写入 JWT
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "USER";
        // “记住我”：未勾选时 1 天后过期（JWT 绝对过期时间）
        const remember = (user as { remember?: boolean }).remember;
        if (!remember) token.exp = Math.floor(Date.now() / 1000) + 24 * 3600;
      }
      if (trigger === "update" && session?.name) token.name = session.name;
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "USER";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
