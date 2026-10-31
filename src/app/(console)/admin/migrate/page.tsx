import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { migrationStatus } from "@/server/migration.service";
import { MigrateClient, type MarkerOpt } from "@/components/migrate-client";

// 存储迁移管理：独立页面，逐张勾选要迁移的图片（本地照片只有在这里手动迁移才会进入存储桶）
export default async function AdminMigratePage() {
  await requireAdmin();
  const s = await getSettings();
  const markers: MarkerOpt[] = [
    { marker: "local", label: "本地磁盘" },
    ...s.r2Slots
      .map((cfg, i) => ({ cfg, i }))
      .filter(({ cfg }) => cfg.accessKeyId && slotConfigured(cfg))
      .map(({ cfg, i }) => ({ marker: `r2:${i}`, label: slotDisplayName(cfg, i, s.r2Slots.length) })),
  ];
  return <MigrateClient markers={markers} initialStatus={migrationStatus()} />;
}
