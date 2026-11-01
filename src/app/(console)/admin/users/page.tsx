import { requireSuper } from "@/lib/session";
import { AdminUsersClient } from "@/components/admin-users-client";

// 用户管理：仅超级管理员（普通管理员不开放）
export default async function AdminUsersPage() {
  await requireSuper();
  return <AdminUsersClient />;
}
