import { requireUser } from "@/lib/session";
import { SettingsClient } from "@/components/settings-client";

export default async function DashboardSettingsPage() {
  const user = await requireUser();
  return (
    <SettingsClient
      user={{
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
        storageUsed: user.storageUsed.toString(),
        storageQuota: user.storageQuota.toString(),
        createdAt: user.createdAt.toISOString(),
      }}
    />
  );
}
