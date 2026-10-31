import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { migrationStatus } from "@/server/migration.service";
import { r2SlotLabel } from "@/lib/storage";

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
  const s = slot as { accountId?: string; accessKeyId?: string; secretAccessKey?: string; bucket?: string } | undefined;
  return s && s.accountId && s.accessKeyId && s.secretAccessKey && s.bucket
    ? (s as { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string })
    : null;
}

function clientOf(cfg: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
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
      const st: SlotSyncStatus = { marker, label: r2SlotLabel(i), checked: 0, adopted: 0, removed: 0, error: null, at: null };
      state.slots.push(st);
      try {
        const cfg = completeCfg(settings.r2Slots[i]);
        if (!cfg) {
          st.error = "未配置完整";
          continue;
        }
        const client = clientOf(cfg);
        const objects = await listAll(client, cfg.bucket);
        st.checked = objects.size;

        // 站有桶无 → 删除记录（桶是事实源；回收站软删记录的对象仍在桶里，key 匹配不受影响）
        const records = await prisma.image.findMany({
          where: { storage: marker },
          select: { id: true, storageKey: true },
        });
        const known = new Set(records.map((r) => r.storageKey));
        const missing = records.filter((r) => !objects.has(r.storageKey)).map((r) => r.id);
        if (missing.length > 0) {
          const del = await prisma.image.deleteMany({ where: { id: { in: missing }, storage: marker } });
          st.removed = del.count;
        }

        // 桶有站无 → 收录（2 分钟前的旧对象 + Head 复核，避开上传/删除竞态；连接测试对象跳过）
        const cutoff = Date.now() - ADOPT_AFTER_MS;
        if (owner) {
          for (const [key, obj] of objects) {
            if (known.has(key) || key.startsWith("__imagehub")) continue;
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
