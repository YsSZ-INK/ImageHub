import { requireUser } from "@/lib/session";
import { localUsageOf } from "@/server/storage-stats";
import { SettingsClient } from "@/components/settings-client";

export default async function DashboardSettingsPage() {
  const user = await requireUser();
  // 配额口径：仅统计本地磁盘文件占用（R2 中的文件不占配额）
  const storageUsed = await localUsageOf(user.id);
  return (
    <SettingsClient
      user={{
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
        storageUsed: storageUsed.toString(),
        storageQuota: user.storageQuota.toString(),
        createdAt: user.createdAt.toISOString(),
      }}
    />
  );
}
