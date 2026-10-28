import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { User } from "@prisma/client";

// 取当前登录用户（回查数据库，封禁/删除即时生效，不能只靠前端隐藏）
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user || user.status === "BANNED") return null;
  return user;
}

// 页面守卫：未登录重定向到 / 并保留 callbackUrl
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

// 页面守卫：需要 ADMIN 角色
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/gallery");
  return user;
}

// API 守卫：未登录返回 401
export async function requireApiUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("未登录", 401);
  return user;
}

// API 守卫：需要 ADMIN
export async function requireApiAdmin(): Promise<User> {
  const user = await requireApiUser();
  if (user.role !== "ADMIN") throw new AppError("无权限", 403);
  return user;
}
