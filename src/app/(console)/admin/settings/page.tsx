import { requireSuper } from "@/lib/session";
import { AdminSettingsClient } from "@/components/admin-settings-client";

// 管理后台：站点设置（仅超级管理员；操作日志从设置页头部的「操作日志」按钮打开）
export default async function AdminSettingsPage() {
  await requireSuper();
  return <AdminSettingsClient />;
}
