import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";

/**
 * 会话 Cookie 分级：
 * - 勾「记住我」→ 持久 Cookie 3 天（与 session.maxAge 一致）
 * - 未勾 → 浏览器会话 Cookie（关浏览器即失效），JWT 本身另有 24h 上限双保险
 *
 * NextAuth 的 Cookie Max-Age 是静态配置，无法按单次登录动态变化，
 * 因此在 POST /api/auth/callback/credentials 的响应上拦截改写：
 * 未勾记住我时去掉 session-token 的 Max-Age 属性（有 Max-Age 为持久 Cookie，无则为会话 Cookie）。
 */

const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token=/;

export const GET = handlers.GET;

export async function POST(req: NextRequest) {
  const isCredCallback = new URL(req.url).pathname.endsWith("/callback/credentials");
  if (!isCredCallback) return handlers.POST(req);

  const body = await req.clone().text();
  const remember = new URLSearchParams(body).get("remember") === "true";
  const res = await handlers.POST(req);

  if (remember) return res;

  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (!setCookies.some((sc) => SESSION_COOKIE.test(sc))) return res;

  const headers = new Headers(res.headers);
  headers.delete("set-cookie");
  for (const sc of setCookies) {
    // 只改 session-token：去掉 Expires / Max-Age 变成浏览器会话 Cookie；其他（csrf/state 等）原样
    headers.append("set-cookie", SESSION_COOKIE.test(sc) ? sc.replace(/;\s*(?:Expires=[^;]+|Max-Age=\d+)/gi, "") : sc);
  }
  return new Response(res.body, { status: res.status, headers });
}
