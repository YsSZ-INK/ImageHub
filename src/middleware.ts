import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isAdminRole, isSuper } from "@/lib/roles";

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
  "/api/session/reset", // 清理失效会话 cookie（见 session.ts 的重定向防环）
  "/api/health",
];

const PUBLIC_PAGES = ["/", "/forgot-password", "/reset-password", "/verify-email"];

// 图片直链（raw/thumb）对匿名放行到路由层，由可见性校验决定（仅 PUBLIC 可作免登录外链；友链需登录）
const ANON_IMAGE_ASSET_RE = /^\/api\/images\/[^/]+\/(raw|thumb)$/;

const PROTECTED_PAGE_PREFIX = ["/gallery", "/u/", "/albums", "/images", "/trash", "/settings", "/admin"];

const INK_BG_COUNT = 4; // public/ink-1..4.webp

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

  // /api/* 下管理路由的前缀是 /api/admin，此处做全局预检，防止未来某个管理路由漏写守卫。
  // 权限分级：/api/admin/images* 两级管理员可用（图片审核队列），
  // 其余管理接口（用户/设置/存储/备份/日志）仅超级管理员。
  if (logged && path.startsWith("/api/admin")) {
    const ok = path.startsWith("/api/admin/images") ? isAdminRole(role) : isSuper(role);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "无权限" }, { status: 403 });
    }
  }

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

  // 管理后台页面：两级管理员均可进入（超管专属页由页面守卫拦截）
  if (logged && path.startsWith("/admin") && !isAdminRole(role)) {
    return NextResponse.redirect(new URL("/gallery", nextUrl));
  }

  return nextWithInkBg(req);
});

export const config = {
  // 跳过静态资源、NextAuth 自身路由（避免回调被中间件双重处理导致 MissingCSRF）
  // 与 /api/upload、/api/admin/backup/restore（路由自带鉴权；middleware 会缓冲请求体，大文件传输不必要地受限）
  // 以及图片直链 raw/thumb（全站 QPS 最高的路径，路由层自带可见性校验，无需边缘再解一遍 JWT）
  // 与 ink-*.webp 静态背景（无需鉴权/cookie 逻辑，否则每张背景图请求都白跑一次中间件）
  matcher: [
    "/((?!api/auth|api/upload|api/admin/backup/restore|api/images/[^/]+/(?:raw|thumb)|_next/static|_next/image|favicon.ico|ink-[1-4].webp).*)",
  ],
};
