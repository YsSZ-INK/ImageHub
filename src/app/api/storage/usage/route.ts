import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { isAdminRole } from "@/lib/roles";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { storageSnapshot } from "@/server/storage-stats";

export const runtime = "nodejs";

// 侧栏存储卡片轮询接口（登录即可）：个人配额 + 本地占用 + 各已配置 R2 槽位占用
// 纯数据库聚合，轻量；客户端每 10 秒拉一次实现局部刷新
// 只统计「配置完整」的槽位：断开连接（清空配置）保存后，对应卡片随之消失（用量重置）
// 普通用户仅返回本人用量（本地 + 各槽位自己的占用）；
// 全站聚合（不含 userId 过滤）仅管理员/超管可见
export const GET = handle(async () => {
  const user = await requireApiUser();
  const settings = await getSettings();
  const active = settings.r2Slots
    .map((cfg, i) => ({ cfg, i }))
    .filter(({ cfg }) => cfg.accessKeyId && cfg.bucket && slotConfigured(cfg));
  const snap = await storageSnapshot(
    user.id,
    user.storageQuota,
    active.map(({ i }) => `r2:${i}`),
    isAdminRole(user.role) ? null : user.id
  );
  return ok({
    ...snap,
    slots: snap.slots.map((s, n) => ({
      ...s,
      label: slotDisplayName(active[n].cfg, active[n].i, settings.r2Slots.length),
    })),
  });
});
