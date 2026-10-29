import { requireAdmin } from "@/lib/session";

// 管理后台守卫：/admin/* 仅管理员（侧栏「系统」分组对所有页面的管理员常驻）
export default async function AdminGateLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
