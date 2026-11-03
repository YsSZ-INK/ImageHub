import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 清除会话 cookie：令牌仍在浏览器里、但服务端校验已不通过（改密 / 被封禁 / 账号已删）时，
// 先来这里清空旧 cookie 再回登录页，否则中间件仍当作已登录，会与页面守卫互相跳转形成死循环。
const NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url));
  for (const name of NAMES) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
    // 大 token 会被拆成 .0 / .1 … 分片，一并清掉
    for (let i = 0; i < 5; i++) res.cookies.set(`${name}.${i}`, "", { path: "/", maxAge: 0 });
  }
  return res;
}
