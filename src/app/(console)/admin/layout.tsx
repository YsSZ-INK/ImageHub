import { requireAdmin } from "@/lib/session";

// 管理后台守卫：/admin/* 两级管理员可进入（用户管理/站点设置/存储迁移等超管专属页由各自页面守卫拦截）
export default async function AdminGateLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
