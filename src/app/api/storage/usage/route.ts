import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { r2SlotLabel } from "@/lib/storage";
import { storageSnapshot } from "@/server/storage-stats";

export const runtime = "nodejs";

// 侧栏存储卡片轮询接口（登录即可）：个人配额 + 本地占用 + 各 R2 槽位占用
// 纯数据库聚合，轻量；客户端每 10 秒拉一次实现局部刷新
export const GET = handle(async () => {
  const user = await requireApiUser();
  const settings = await getSettings();
  const snap = await storageSnapshot(
    user.id,
    user.storageQuota,
    settings.r2Slots.map((_, i) => `r2:${i}`)
  );
  return ok({
    ...snap,
    slots: snap.slots.map((s, n) => ({ ...s, label: r2SlotLabel(n) })),
  });
});
