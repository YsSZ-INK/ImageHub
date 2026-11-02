import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isAdminRole, isSuper } from "@/lib/roles";
import type { User } from "@prisma/client";

// 取当前登录用户（回查数据库，封禁/删除即时生效，不能只靠前端隐藏）
// React cache：同一次请求内去重——ConsoleShell 布局与页面各调一次 requireUser 时只查一次库
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user || user.status === "BANNED") return null;
  // 会话吊销：JWT 签发时快照 tokenVersion，与库中当前值不一致（密码已变更或被管理员重置）
  // 则旧会话立即失效，需重新登录。缺省视为 0，与 schema 默认值一致。
  if (session.user.tokenVersion !== user.tokenVersion) return null;
  return user;
});

// 页面守卫：未登录重定向到 / 并保留 callbackUrl
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

// 页面守卫：需要管理员（ADMIN 或 SUPERADMIN，内容管理层）
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdminRole(user.role)) redirect("/gallery");
  return user;
}

// 页面守卫：需要超级管理员（用户管理/站点设置/存储迁移等）
export async function requireSuper(): Promise<User> {
  const user = await requireUser();
  if (!isSuper(user.role)) redirect("/gallery");
  return user;
}

// API 守卫：未登录返回 401
export async function requireApiUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("未登录", 401);
  return user;
}

// API 守卫：需要管理员（两级均可）
export async function requireApiAdmin(): Promise<User> {
  const user = await requireApiUser();
  if (!isAdminRole(user.role)) throw new AppError("无权限", 403);
  return user;
}

// API 守卫：需要超级管理员
export async function requireApiSuper(): Promise<User> {
  const user = await requireApiUser();
  if (!isSuper(user.role)) throw new AppError("无权限", 403);
  return user;
}
