import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getStorageFor, getLocalStorage, type Storage } from "@/lib/storage";
import { listR2Objects } from "@/lib/storage/r2";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { logActivity } from "@/server/audit.service";
import { invalidateImageView } from "@/server/image.service";

export type MissingRecord = {
  id: string;
  filename: string;
  size: number;
  storage: string;
  createdAt: string;
  ownerName: string | null;
};

export type ReconcileResult = {
  checked: number;
  present: number;
  missing: number;
  unconfigured: number;
  missingIds: string[];
  missingItems: MissingRecord[];
  // 指向未配置槽位的记录：无法判断文件是否存在，但可以把记录本身列出来给管理员看
  unconfiguredItems: MissingRecord[];
};

// R2 记录一致性校验：逐一确认指向 R2 的记录，其对象在桶中是否真实存在。
// 用于处理「数据库有记录、桶里没文件」的孤儿记录（如曾在 Cloudflare 后台直接清空桶）。
export async function reconcileR2(): Promise<ReconcileResult> {
  const rows = await prisma.image.findMany({
    where: { storage: { not: "local" } },
    select: {
      id: true,
      storage: true,
      storageKey: true,
      filename: true,
      size: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  const res: ReconcileResult = {
    checked: rows.length,
    present: 0,
    missing: 0,
    unconfigured: 0,
    missingIds: [],
    missingItems: [],
    unconfiguredItems: [],
  };
  // 同一槽位的存储实例复用；槽位未配置完整时该槽位记录无法校验，单独计数
  const cache = new Map<string, Storage | null>();
  for (const r of rows) {
    if (!cache.has(r.storage)) {
      try {
        cache.set(r.storage, await getStorageFor(r.storage));
      } catch {
        cache.set(r.storage, null);
      }
    }
    const storage = cache.get(r.storage);
    if (!storage) {
      res.unconfigured++;
      res.unconfiguredItems.push({
        id: r.id,
        filename: r.filename,
        size: r.size,
        storage: r.storage,
        createdAt: r.createdAt.toISOString(),
        ownerName: r.user?.name ?? null,
      });
      continue;
    }
    if (await storage.exists(r.storageKey)) res.present++;
    else {
      res.missing++;
      res.missingIds.push(r.id);
      res.missingItems.push({
        id: r.id,
        filename: r.filename,
        size: r.size,
        storage: r.storage,
        createdAt: r.createdAt.toISOString(),
        ownerName: r.user?.name ?? null,
      });
    }
  }
  return res;
}

// 清理缺失记录（仅删除校验结果中确认缺失的记录，二次确认后才执行）
export async function purgeMissingR2(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const del = await prisma.image.deleteMany({
    where: { id: { in: ids }, storage: { startsWith: "r2:" } },
  });
  await invalidateImageView(...ids);
  return del.count;
}

// ============ 桶内多余文件核对（桶有站无） ============
// 网站删除图片后，若存储对象因网络/权限等原因没能同步删除，桶里会残留文件。
// 这里列出「桶内存在、但网站已无任何记录引用」的对象，由管理员决定保留还是从桶内删除。
// 上传中的文件（刚写入桶、记录尚未落库）与缩略图/探测对象不参与核对。

const ORPHAN_MAX_ITEMS = 500; // 列表上限：只需展示待处理的一批，总量另行计数
const ORPHAN_RECENT_MS = 2 * 60_000;
const OBJECT_EXT = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "tiff",
  "mp4", "m4v", "webm", "mov", "mkv",
]);

export type BucketOrphanItem = {
  slot: string;
  label: string;
  key: string;
  size: number;
  lastModified: string;
};

export type BucketOrphanScan = {
  slots: number; // 本次实际扫描的已配置槽位数量
  objects: number; // 已配置槽位的桶内对象总数
  total: number; // 未被引用的对象总数（items 可能被截断）
  truncated: boolean;
  items: BucketOrphanItem[];
  errors: string[]; // 单个槽位读取失败的原因
};

// 槽位对应的存储标记（与 R2 同步同一口径，兼容早期 r2 / r2b 写法）
function slotFamily(index: number): string[] {
  const family = [`r2:${index}`];
  if (index === 0) family.push("r2");
  if (index === 1) family.push("r2b");
  return family;
}

// 扫描所有已配置槽位，汇总「桶里有、网站没有」的对象
export async function scanBucketOrphans(): Promise<BucketOrphanScan> {
  const s = await getSettings();
  const res: BucketOrphanScan = { slots: 0, objects: 0, total: 0, truncated: false, items: [], errors: [] };
  // 引用集合按槽位分组：只统计指向该槽位的记录（回收站记录的对象仍在桶里，同样算被引用）
  const records = await prisma.image.findMany({ select: { storage: true, storageKey: true, thumbKey: true } });
  const cutoff = Date.now() - ORPHAN_RECENT_MS;

  for (let i = 0; i < s.r2Slots.length; i++) {
    const cfg = s.r2Slots[i];
    const label = slotDisplayName(cfg, i, s.r2Slots.length);
    if (!cfg?.accessKeyId || !cfg?.secretAccessKey || !slotConfigured(cfg)) continue;
    res.slots++;
    try {
      const family = slotFamily(i);
      const referenced = new Set<string>();
      for (const r of records) {
        if (!family.includes(r.storage)) continue;
        referenced.add(r.storageKey);
        if (r.thumbKey) referenced.add(r.thumbKey);
      }
      const objects = await listR2Objects(cfg);
      res.objects += objects.size;
      for (const [key, obj] of objects) {
        if (referenced.has(key)) continue;
        // 连接测试对象、旧版桶内缩略图（派生文件）不算多余照片
        if (key.startsWith("__imagehub") || key.startsWith("thumbs/")) continue;
        if (!OBJECT_EXT.has((key.split(".").pop() ?? "").toLowerCase())) continue;
        if (obj.lastModified.getTime() > cutoff) continue; // 刚上传、记录可能还在落库
        res.total++;
        if (res.items.length < ORPHAN_MAX_ITEMS) {
          res.items.push({ slot: `r2:${i}`, label, key, size: obj.size, lastModified: obj.lastModified.toISOString() });
        } else res.truncated = true;
      }
    } catch (e) {
      res.errors.push(`${label}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  res.items.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return res;
}

// 从桶内删除选中的多余对象：删除前复核一次引用，网站仍在使用的文件一律跳过
export async function deleteBucketOrphans(
  items: { slot: string; key: string }[]
): Promise<{ deleted: number; skipped: number; failed: number }> {
  const out = { deleted: 0, skipped: 0, failed: 0 };
  const bySlot = new Map<string, string[]>();
  for (const it of items) {
    if (typeof it?.slot !== "string" || typeof it?.key !== "string") continue;
    const arr = bySlot.get(it.slot) ?? [];
    arr.push(it.key);
    bySlot.set(it.slot, arr);
  }

  for (const [slot, keys] of bySlot) {
    const index = Number.parseInt(slot.slice(3), 10);
    if (!Number.isInteger(index) || index < 0) {
      out.failed += keys.length;
      continue;
    }
    const s = await getSettings();
    const cfg = s.r2Slots[index];
    if (!cfg?.accessKeyId || !cfg?.secretAccessKey || !slotConfigured(cfg)) {
      throw new AppError(`${slotDisplayName(cfg, index, s.r2Slots.length)}未配置完整`, 400);
    }
    const family = slotFamily(index);
    const rows = await prisma.image.findMany({
      where: { storage: { in: family } },
      select: { storageKey: true, thumbKey: true },
    });
    const referenced = new Set<string>();
    for (const r of rows) {
      referenced.add(r.storageKey);
      if (r.thumbKey) referenced.add(r.thumbKey);
    }
    const storage = await getStorageFor(slot);
    for (const key of keys) {
      if (!key || referenced.has(key)) {
        out.skipped++;
        continue;
      }
      try {
        await storage.delete(key);
        out.deleted++;
      } catch (e) {
        console.error("[reconcile] 删除桶内对象失败:", key, e);
        out.failed++;
      }
    }
  }
  return out;
}

const ADOPT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

// 把桶内「网站没记录」的文件下载到本地磁盘并收录为网站图片（归属操作者），成功后删除桶内副本。
// 用于把一批桶内残留文件「拉回」网站，之后可在「我的图片」里管理。
export async function adoptBucketObjects(
  items: { slot: string; key: string }[],
  viewer: { id: string }
): Promise<{ adopted: number; failed: number }> {
  const out = { adopted: 0, failed: 0 };
  const local = await getLocalStorage();
  for (const it of items) {
    try {
      if (!/^r2:\d+$/.test(it.slot) || !/^(images|videos)\/[A-Za-z0-9._/-]+$/.test(it.key) || it.key.includes("..")) {
        out.failed++;
        continue;
      }
      const ext = (it.key.split(".").pop() ?? "").toLowerCase();
      const mime = ADOPT_MIME[ext];
      if (!mime) {
        out.failed++;
        continue;
      }
      // 已有记录在用同一对象时跳过，避免重复收录
      const exists = await prisma.image.findFirst({
        where: { storageKey: it.key, storage: it.slot },
        select: { id: true },
      });
      if (exists) {
        out.failed++;
        continue;
      }
      const storage = await getStorageFor(it.slot);
      const buf = await storage.get(it.key);
      await local.put(it.key, buf, { contentType: mime });
      await prisma.image.create({
        data: {
          userId: viewer.id,
          filename: decodeURIComponent(it.key.split("/").pop() || it.key),
          storageKey: it.key,
          thumbKey: "",
          storage: "local",
          mimeType: mime,
          size: buf.length,
          width: 0,
          height: 0,
          sha256: `adopt:${it.key}`,
          visibility: "PUBLIC",
          status: "PUBLISHED",
        },
      });
      await storage.delete(it.key);
      out.adopted++;
    } catch (e) {
      console.error("[reconcile] 收录桶内文件失败:", it.key, e);
      out.failed++;
    }
  }
  if (out.adopted > 0) {
    await logActivity(viewer.id, "storage_adopt", `从桶内移入网站 ${out.adopted} 个文件`);
  }
  return out;
}
