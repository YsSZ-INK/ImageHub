import { prisma } from "@/lib/db";
import { getStorageFor, r2SlotIndex } from "@/lib/storage";
import { AppError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { testR2Connection } from "@/lib/storage/r2";
import { markerLabel, slotConfigured, slotDisplayName } from "@/lib/markers";

/**
 * 存量存储迁移：把已上传文件的物理位置在 本地磁盘 与各个 R2 桶之间整体搬迁。
 * 位置标记：local | r2:<桶下标>。逐张「读源 → 写目标 → 更新记录 → 删源文件」。
 * 任务状态保存在进程内存：应用重启后未迁移的记录会保留原位置，重新发起即可续迁（幂等）。
 */
export type MigrationMarker = string; // "local" | "r2:<n>"

type MigrationState = {
  running: boolean;
  direction: string | null;
  done: number;
  total: number;
  failed: number;
  errors: string[];
  startedAt: number | null;
  finishedAt: number | null;
};

const state: MigrationState = {
  running: false,
  direction: null,
  done: 0,
  total: 0,
  failed: 0,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

export function migrationStatus() {
  return { ...state, errors: state.errors.slice(-20) };
}

export type MigrationStatus = ReturnType<typeof migrationStatus>;

// 校验某个 R2 槽位配置完整，返回其连接参数
function r2Cfg(
  slots: { type?: string; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint?: string; region?: string }[],
  marker: MigrationMarker
) {
  const idx = r2SlotIndex(marker);
  const cfg = slots[idx];
  if (!cfg || !cfg.accessKeyId || !cfg.secretAccessKey || !slotConfigured(cfg)) {
    throw new AppError(
      `${cfg ? slotDisplayName(cfg, idx, slots.length) : markerLabel(marker)}尚未配置完整，请先在上方填写并保存存储设置`,
      400
    );
  }
  return cfg;
}

export async function startMigration(from: MigrationMarker, target: MigrationMarker, ids?: string[]) {
  if (from === target) throw new AppError("源位置与目标位置相同", 400);
  if (state.running) throw new AppError("已有迁移任务在进行中，请等待完成", 409);
  const s = await getSettings();
  // 发起前先验证两端可用：R2 端校验配置完整，目标为 R2 时再真实连通性测试
  if (from !== "local") r2Cfg(s.r2Slots, from);
  const targetCfg = target === "local" ? null : r2Cfg(s.r2Slots, target);
  if (targetCfg) {
    try {
      await testR2Connection(targetCfg);
    } catch {
      throw new AppError(`${markerLabel(target)}连接测试未通过，请先「测试连接」排查后再发起迁移`, 400);
    }
  }
  if (ids && ids.length === 0) throw new AppError("请至少选择一张图片", 400);
  state.running = true;
  state.direction = `${from}>${target}`;
  state.done = 0;
  state.total = 0;
  state.failed = 0;
  state.errors = [];
  state.startedAt = Date.now();
  state.finishedAt = null;
  // 后台执行，接口立即返回
  void runMigration(from, target, ids).catch(() => {});
  return { started: true };
}

async function runMigration(from: MigrationMarker, target: MigrationMarker, ids?: string[]) {
  try {
    const images = await prisma.image.findMany({
      // 指定 ids 时仅迁移勾选的图片；否则迁移该位置的全部图片
      where: { storage: from, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, storageKey: true, thumbKey: true, mimeType: true },
    });
    state.total = images.length;
    const src = await getStorageFor(from);
    const dst = await getStorageFor(target);

    for (const img of images) {
      try {
        // 原文件：读源 → 写目标（响应头使用 Image.mimeType，对象 ContentType 仅作记录）
        const buf = await src.get(img.storageKey);
        await dst.put(img.storageKey, buf, { contentType: img.mimeType });
        if (img.thumbKey) {
          const thumb = await src.get(img.thumbKey);
          await dst.put(img.thumbKey, thumb, { contentType: "image/webp" });
        }
        // 记录更新成功后才删除源文件，任何一步失败该图片留在原位置可重试
        await prisma.image.update({ where: { id: img.id }, data: { storage: target } });
        await src.delete(img.storageKey);
        if (img.thumbKey) await src.delete(img.thumbKey);
      } catch (err) {
        state.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        state.errors.push(`图片 ${img.id}（${img.storageKey}）：${msg}`);
      }
      state.done += 1;
    }
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
  }
}
