import { requireUser } from "@/lib/session";
import { listAlbums } from "@/server/image.service";
import { getSettings } from "@/lib/settings";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { MyImagesClient } from "@/components/my-images-client";
import type { MarkerOpt } from "@/components/migrate-client";

// 我的图片：支持按存储位置筛选（本地 / 各个存储桶）
export default async function DashboardPage() {
  const user = await requireUser();
  const albums = await listAlbums(user);
  const s = await getSettings();
  const storages: MarkerOpt[] = [
    { marker: "local", label: "本地磁盘" },
    ...s.r2Slots
      .map((cfg, i) => ({ cfg, i }))
      .filter(({ cfg }) => cfg.accessKeyId && slotConfigured(cfg))
      .map(({ cfg, i }) => ({ marker: `r2:${i}`, label: slotDisplayName(cfg, i, s.r2Slots.length) })),
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">我的图片</h1>
      <MyImagesClient
        albums={albums.map((a) => ({ id: a.id, name: a.name }))}
        storages={storages}
      />
    </div>
  );
}
