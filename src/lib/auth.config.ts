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
        // 签发时快照 tokenVersion，改密后与库中值失配即视为旧会话（见 session.ts）
        token.tv = (user as { tokenVersion?: number }).tokenVersion ?? 0;
      }
      if (trigger === "update" && session?.name) token.name = session.name;
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "USER";
        session.user.tokenVersion = typeof token.tv === "number" ? token.tv : undefined;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
