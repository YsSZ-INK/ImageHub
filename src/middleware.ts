import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// 访问控制中间件（边缘运行时）：
// - 未登录只能访问 / 与认证相关页面
// - 受保护页面 → 302 到 /?callbackUrl=...
// - 受保护 API → 401 JSON
// - 已登录访问 / → 302 /gallery
const { auth } = NextAuth(authConfig);

// 允许未登录访问的 API（认证流程本身）
const PUBLIC_API = [
  "/api/auth",
  "/api/register",
  "/api/account/reset", // POST 请求重置 / PUT 执行重置均匿名
  "/api/health",
];

const PUBLIC_PAGES = ["/", "/forgot-password", "/reset-password", "/verify-email"];

// 图片直链（raw/thumb）对匿名放行到路由层，由可见性校验决定（PUBLIC/UNLISTED 可作外链）
const ANON_IMAGE_ASSET_RE = /^\/api\/images\/[^/]+\/(raw|thumb)$/;

const PROTECTED_PAGE_PREFIX = ["/gallery", "/u/", "/albums", "/images", "/trash", "/settings", "/admin"];

const INK_BG_COUNT = 4; // public/ink-1..4.png

/** 每个会话固定一幅水墨图（cookie 锁定），登录页与后台同图 */
function nextWithInkBg(req: Parameters<Parameters<typeof auth>[0]>[0]) {
  if (!req.cookies.get("ink-bg")) {
    const idx = String(Math.floor(Math.random() * INK_BG_COUNT));
    // 改写请求头：当前请求的页面组件即可读到
    req.cookies.set("ink-bg", idx);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set("ink-bg", idx, { path: "/", maxAge: 60 * 60 * 24, sameSite: "lax" });
    return res;
  }
  return NextResponse.next();
}

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const logged = !!req.auth;
  const role = req.auth?.user?.role;

  // 已登录访问首页 → 画廊
  if (logged && path === "/") {
    return NextResponse.redirect(new URL("/gallery", nextUrl));
  }

  // 认证页面放行
  if (PUBLIC_PAGES.includes(path)) return nextWithInkBg(req);

  const isProtectedPage = PROTECTED_PAGE_PREFIX.some((p) => path.startsWith(p));
  const isProtectedApi =
    path.startsWith("/api/") &&
    !PUBLIC_API.some((p) => path.startsWith(p)) &&
    !(logged === false && ANON_IMAGE_ASSET_RE.test(path));

  if (!logged && (isProtectedPage || isProtectedApi)) {
    if (isProtectedApi) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }
    const url = new URL("/", nextUrl);
    url.searchParams.set("callbackUrl", path + nextUrl.search);
    return NextResponse.redirect(url);
  }

  // 管理后台仅 ADMIN
  if (logged && path.startsWith("/admin")) {
    if (role !== "ADMIN") {
      if (path.startsWith("/api/admin")) {
        return NextResponse.json({ ok: false, error: "无权限" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/gallery", nextUrl));
    }
  }

  return nextWithInkBg(req);
});

export const config = {
  // 跳过静态资源与 NextAuth 自身路由（避免回调被中间件双重处理导致 MissingCSRF）
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
