import { prisma } from "@/lib/db";
import { getSettings, type R2SlotConfig } from "@/lib/settings";
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { migrationStatus } from "@/server/migration.service";
import { makeS3Client } from "@/lib/storage/r2";
import { getStorageFor } from "@/lib/storage";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { getThumb } from "@/lib/thumb-cache";
import sharp from "sharp";

/**
 * R2 双向同步：以桶内对象为事实源，与数据库记录定时对账。
 * - 桶有站无 → 收录新记录（公开、归管理员，缩略图直接用原对象）
 * - 站有桶无 → 删除记录（如在 Cloudflare 后台手动删了照片，网站跟着少一张）
 * - 迁移进行中自动暂停（迁移存在「记录指向尚未复制完的对象」中间态）
 * - 收录仅针对 2 分钟前的旧对象并 Head 复核，避开「刚写桶、记录未落库」的上传竞态
 */

export type SlotSyncStatus = {
  marker: string;
  label: string;
  checked: number; // 桶内对象总数
  adopted: number; // 本次新收录
  removed: number; // 本次删除的孤儿记录
  error: string | null;
  at: number | null;
};

export type SyncStatus = {
  running: boolean;
  lastRun: number | null;
  intervalMs: number;
  slots: SlotSyncStatus[];
};

const INTERVAL_MS = 30_000;
const ADOPT_AFTER_MS = 2 * 60_000;
// 仅收录图片/视频扩展名的对象（避免把桶里手工放的其他文件当成图片收录）
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif", mp4: "video/mp4", m4v: "video/mp4",
  webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
};

const state: SyncStatus = { running: false, lastRun: null, intervalMs: INTERVAL_MS, slots: [] };
let started = false;

export function syncStatus(): SyncStatus {
  return { ...state, slots: state.slots.map((s) => ({ ...s })) };
}

function completeCfg(slot: unknown) {
  const s = slot as Partial<R2SlotConfig> | undefined;
  // 槽位有效 = 桶与密钥齐全，且端点可推导（R2 Account ID / OSS·COS Region / S3 端点）
  return s && s.accessKeyId && s.secretAccessKey && slotConfigured(s) ? (s as R2SlotConfig) : null;
}

function clientOf(cfg: Parameters<typeof makeS3Client>[0]) {
  return makeS3Client(cfg);
}

// 槽位对应的全部存储标记：r2:<i> 为现行写法；早期版本遗留 r2（槽一）/ r2b（槽二）。
// 对账必须把旧标记的记录也算进同一桶，否则会重复收录同一对象
function slotFamily(index: number): string[] {
  const family = [`r2:${index}`];
  if (index === 0) family.push("r2");
  if (index === 1) family.push("r2b");
  return family;
}

async function listAll(client: S3Client, bucket: string): Promise<Map<string, { size: number; lastModified: Date }>> {
  const map = new Map<string, { size: number; lastModified: Date }>();
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of res.Contents ?? []) {
      if (o.Key) map.set(o.Key, { size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return map;
}

// 执行一轮双向对账（同一时间仅一轮，进行中调用直接返回当前状态）
export async function syncR2Once(): Promise<SyncStatus> {
  if (state.running || migrationStatus().running) return syncStatus();
  state.running = true;
  state.slots = [];
  try {
    const settings = await getSettings();
    const owner = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    for (let i = 0; i < settings.r2Slots.length; i++) {
      const marker = `r2:${i}`;
      const family = slotFamily(i);
      const cfg = completeCfg(settings.r2Slots[i]);
      const st: SlotSyncStatus = { marker, label: slotDisplayName(cfg, i, settings.r2Slots.length), checked: 0, adopted: 0, removed: 0, error: null, at: null };
      state.slots.push(st);
      try {
        if (!cfg) {
          st.error = "未配置完整";
          continue;
        }
        const client = clientOf(cfg);
        const objects = await listAll(client, cfg.bucket);
        st.checked = objects.size;

        const records = await prisma.image.findMany({
          where: { storage: { in: family } },
          select: { id: true, storageKey: true, storage: true, createdAt: true },
        });

        // 防全灭保护：桶视图异常（网络截断 / 分页中断 / 配置漂移导致空或残缺列表）时绝不批量删除。
        // 曾发生过 ListObjects 返回空 → 全部记录被误判「桶里没有」而清空的事故；文件在桶里完好，只有记录遭殃
        if (objects.size === 0 && records.length > 0) {
          st.error = "桶内对象列表为空，本轮跳过对账（防误删保护）";
          continue;
        }

        // 站有桶无 → 删除记录（桶是事实源；回收站软删记录的对象仍在桶里，key 匹配不受影响）。
        // 记录按槽位全家族标记匹配（含早期 r2/r2b），旧标记记录不会误判为「桶有站无」而重复收录
        // 自愈重复记录：同一对象 key 建了多条（历史遗留）只保留一条——
        // 优先现行标记 r2:<i>，否则保留最早创建的；其余删除
        const byKey = new Map<string, typeof records>();
        for (const r of records) {
          const arr = byKey.get(r.storageKey);
          if (arr) arr.push(r);
          else byKey.set(r.storageKey, [r]);
        }
        const dupIds: string[] = [];
        for (const arr of byKey.values()) {
          if (arr.length < 2) continue;
          arr.sort(
            (a, b) =>
              (a.storage === marker ? 0 : 1) - (b.storage === marker ? 0 : 1) ||
              a.createdAt.getTime() - b.createdAt.getTime()
          );
          for (const r of arr.slice(1)) dupIds.push(r.id);
        }
        if (dupIds.length > 0) {
          const del = await prisma.image.deleteMany({ where: { id: { in: dupIds } } });
          st.removed += del.count;
        }

        const known = new Set(records.filter((r) => !dupIds.includes(r.id)).map((r) => r.storageKey));
        const missing = records
          .filter((r) => !dupIds.includes(r.id) && !objects.has(r.storageKey))
          .map((r) => r.id);
        // 大比例缺失同样视为桶视图异常（单桶 > 一半记录同时消失几乎不可能是真实删除）
        if (missing.length > 0 && records.length > 0 && missing.length >= Math.ceil(records.length / 2)) {
          st.error = `疑似桶视图异常：${missing.length}/${records.length} 条记录在桶中未找到，本轮跳过删除`;
        } else if (missing.length > 0) {
          const del = await prisma.image.deleteMany({ where: { id: { in: missing }, storage: { in: family } } });
          st.removed += del.count;
        }

        // 桶有站无 → 收录（2 分钟前的旧对象 + Head 复核，避开上传/删除竞态；连接测试对象跳过）
        const cutoff = Date.now() - ADOPT_AFTER_MS;
        if (owner) {
          for (const [key, obj] of objects) {
            if (known.has(key) || key.startsWith("__imagehub")) continue;
            // thumbs/ 是原图记录自带的缩略图对象，不是独立照片，不收录
            if (key.startsWith("thumbs/")) continue;
            if (obj.lastModified.getTime() > cutoff) continue;
            const ext = (key.split(".").pop() ?? "").toLowerCase();
            if (!EXT_MIME[ext]) continue;
            let head;
            try {
              head = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
            } catch {
              continue; // 复核时已被删除（如刚被站点清掉），跳过
            }
            const filename = decodeURIComponent(key.split("/").pop() || key);
            await prisma.image.create({
              data: {
                userId: owner.id,
                filename,
                storageKey: key,
                thumbKey: key, // 无缩略图文件，缩略路由直接回源原对象
                mimeType: head.ContentType || EXT_MIME[ext],
                size: head.ContentLength ?? obj.size,
                width: 0,
                height: 0,
                sha256: `r2sync:${key}`, // 伪哈希：防止与真实去重哈希碰撞
                visibility: "PUBLIC",
                status: "PUBLISHED",
                storage: marker,
                createdAt: obj.lastModified,
              },
            });
            st.adopted++;
          }
        }
        st.at = Date.now();
      } catch (e) {
        st.error = e instanceof Error ? e.message : String(e);
        st.at = Date.now();
      }
    }
    state.lastRun = Date.now();
    return syncStatus();
  } finally {
    state.running = false;
    // 对账完成后异步预热缩略图/预览档到两级缓存（磁盘命中即零网络请求），浏览时不再等 R2 回源
    void prewarmThumbs().catch(() => {});
  }
}

// 预热：把全部图片的 400px 缩略图拉进缓存（内存 → 磁盘持久化）。
// 2560px 预览档不主动预热（大图缩放是 CPU 重活，小核 VPS 全量预热会把 CPU 打满导致 SSH 饿死），
// 改为灯箱访问时现场生成一次并进磁盘缓存。
// 已缓存的直接跳过（无网络请求）；单张失败静默跳过，下轮对账后自动补。
// 并发自适应：min(2, CPU 核数 - 1)，1-2 核 VPS 单线程跑；每张之间小睡让出 CPU。
let prewarming = false;

const PREWARM_CONCURRENCY = Math.min(2, Math.max(1, require("os").cpus().length - 1));
const PREWARM_GAP_MS = PREWARM_CONCURRENCY <= 1 ? 400 : 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function prewarmThumbs() {
  if (prewarming) return;
  prewarming = true;
  try {
    const imgs = await prisma.image.findMany({
      where: { deletedAt: null, mimeType: { startsWith: "image/" } },
      select: { id: true, storage: true, storageKey: true, thumbKey: true },
      orderBy: { createdAt: "desc" },
    });
    let idx = 0;
    const worker = async () => {
      while (idx < imgs.length) {
        const img = imgs[idx++];
        try {
          const storage = await getStorageFor(img.storage);
          // 缩略图不再作为桶对象：统一从原图现场生成（本地缓存命中则零回源）
          await getThumb(`${img.storage}:${img.storageKey}:gen400`, async () => {
            const raw = await storage.get(img.storageKey);
            return sharp(raw).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
          });
        } catch {
          // 网络差或文件缺失：跳过，下轮预热补
        }
        await sleep(PREWARM_GAP_MS);
      }
    };
    await Promise.all(Array.from({ length: PREWARM_CONCURRENCY }, worker));
  } finally {
    prewarming = false;
  }
}

// 服务器启动后开启定时对账（instrumentation.ts 调用；串行锁防重叠）
export function startR2SyncLoop() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      const s = await getSettings();
      if (s.r2Slots.some((x) => completeCfg(x))) await syncR2Once();
    } catch {
      // 设置/数据库尚未就绪时静默跳过，下个周期重试
    }
  };
  setTimeout(() => void tick(), 10_000);
  setInterval(() => void tick(), INTERVAL_MS);
}
