import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";

/**
 * 会话 Cookie 一律为「浏览器会话 Cookie」：关闭浏览器即失效，下次打开需重新登录。
 *
 * 为什么不能只靠 session.maxAge 或登录时的单次参数：
 * 1. Auth.js 每次 GET /api/auth/session 都会重新签发 JWT，并把 session-token 以
 *    `expires = maxAge`（3 天）重新写回——即使登录时是会话 Cookie，只要访问一次，
 *    它就会变成带过期时间的持久 Cookie，之后每次访问继续顺延（滑动过期），
 *    于是「3 天过期」实际变成「只要 3 天内来过就一直登录」。
 * 2. NextAuth 的 Cookie 属性是静态配置，无法按单次登录动态变化。
 *
 * 因此在路由层统一拦截：所有响应里的 session-token 都剥掉 Expires / Max-Age，
 * 保持会话 Cookie 语义。兼容分片 Cookie（authjs.session-token.0 / .1）。
 */
const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?=/;

function asSessionCookie(res: Response): Response {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (!setCookies.some((sc) => SESSION_COOKIE.test(sc))) return res;

  const headers = new Headers(res.headers);
  headers.delete("set-cookie");
  for (const sc of setCookies) {
    // 只改 session-token：去掉 Expires / Max-Age 即会话 Cookie；其他（csrf / state 等）原样
    headers.append(
      "set-cookie",
      SESSION_COOKIE.test(sc) ? sc.replace(/;\s*(?:Expires=[^;]+|Max-Age=\d+)/gi, "") : sc
    );
  }
  return new Response(res.body, { status: res.status, headers });
}

export async function GET(req: NextRequest) {
  return asSessionCookie(await handlers.GET(req));
}

export async function POST(req: NextRequest) {
  return asSessionCookie(await handlers.POST(req));
}
