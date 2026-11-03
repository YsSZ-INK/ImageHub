// 分片上传服务：大文件切片上传（init → 逐片 PUT → complete 合并入库）
// 会话元数据存 UploadSession 表，分片数据落盘 storage/.chunks/{id}/{i}.part
// 内存占用恒为单片（5MB）：合并阶段流式算 sha256 并拼接，视频流式入存储，图片全量走处理流水线
import { promises as fs, createReadStream, createWriteStream } from "fs";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isAdminRole } from "@/lib/roles";
import { logActivity } from "@/server/audit.service";
import { notifyAdmins } from "@/lib/mailer";
import { storageRoot } from "@/lib/storage/local";
import { processAndStoreImage, processAndStoreVideoFile, detectImageMime, detectVideoMime } from "@/lib/image";
import { localUsageOf } from "@/server/storage-stats";
import { toDTO, ensureMyAlbum, type ImageDTO, type UploadVisibility } from "./image.service";
import type { User } from "@prisma/client";

// 与前端切片大小保持一致
export const CHUNK_SIZE = 5 * 1024 * 1024;
// 分片数上限仅防异常请求；视频不设单文件大小上限，实际受用户存储配额约束
const MAX_CHUNKS = 100_000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// 图片走分片时全量读的上限（sharp 流水线需要 Buffer；正常图片远小于此）
const IMAGE_BUF_LIMIT = 64 * 1024 * 1024;

function chunkDir(id: string) {
  // id 为服务端签发的 cuid，白名单校验防路径拼接意外
  if (!/^[a-z0-9]+$/i.test(id)) throw new AppError("非法上传会话", 400);
  return path.join(storageRoot(), ".chunks", id);
}

// 会话归属校验（防 IDOR）
async function ownSession(id: string, user: User) {
  const s = await prisma.uploadSession.findUnique({ where: { id } });
  if (!s || s.userId !== user.id) throw new AppError("上传会话不存在", 404);
  return s;
}

async function listPartIndices(dir: string): Promise<number[]> {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((n) => /^\d+\.part$/.test(n))
      .map((n) => parseInt(n, 10))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// 清理超时未完成的会话（24h 无活动）：分片目录 + 记录；每次 init 顺手执行
export async function cleanupExpiredSessions() {
  const expired = await prisma.uploadSession.findMany({
    where: { updatedAt: { lt: new Date(Date.now() - SESSION_TTL_MS) } },
    select: { id: true },
  });
  if (expired.length === 0) return;
  for (const s of expired) {
    await fs.rm(chunkDir(s.id), { recursive: true, force: true }).catch(() => {});
  }
  await prisma.uploadSession.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } });
}

async function cleanupSession(id: string) {
  await fs.rm(chunkDir(id), { recursive: true, force: true }).catch(() => {});
  await prisma.uploadSession.delete({ where: { id } }).catch(() => {});
}

// 创建会话：校验分片数自洽，建分片目录
// 不在 init 阶段卡单文件大小：此时 MIME 由客户端声明不可信，统一在 complete 按魔数判定后
// 仅对图片执行站点上限（视频不限大小）
export async function initChunkUpload(
  user: User,
  input: { filename: string; size: number; mimeType: string; totalChunks: number; albumId?: string | null }
) {
  if (!(input.size > 0)) {
    throw new AppError("文件大小不合法", 400);
  }
  if (!Number.isInteger(input.totalChunks) || input.totalChunks < 1 || input.totalChunks > MAX_CHUNKS) {
    throw new AppError("分片数不合法", 400);
  }
  if (input.totalChunks !== Math.ceil(input.size / CHUNK_SIZE)) {
    throw new AppError("分片数与文件大小不匹配", 400);
  }
  // 先清过期会话再预检，避免被僵尸会话误判为「并行过多」
  await cleanupExpiredSessions();
  // 创建会话时预检配额与并行会话数：若拖到 complete 才查配额，可并行创建大量会话、
  // 囤积磁盘分片后永不 complete，白占磁盘与内存元数据。
  const [used, openSessions] = await Promise.all([
    localUsageOf(user.id),
    prisma.uploadSession.count({ where: { userId: user.id } }),
  ]);
  if (openSessions >= 3) {
    throw new AppError("并行上传会话过多（上限 3），请先完成或等待未完成会话过期", 429);
  }
  if (Number(used) + input.size > Number(user.storageQuota)) {
    throw new AppError("存储配额不足，请清理空间或联系管理员", 413);
  }
  const s = await prisma.uploadSession.create({
    data: {
      userId: user.id,
      filename: (input.filename || "file").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 200),
      size: input.size,
      mimeType: (input.mimeType || "").slice(0, 100),
      totalChunks: input.totalChunks,
      albumId: input.albumId ?? null,
    },
  });
  await fs.mkdir(chunkDir(s.id), { recursive: true });
  return { uploadId: s.id };
}

// 收一片：落盘（覆盖写，天然幂等支持重传），并给会话续命
export async function putChunk(user: User, id: string, index: number, buf: Buffer) {
  const s = await ownSession(id, user);
  if (!Number.isInteger(index) || index < 0 || index >= s.totalChunks) throw new AppError("分片下标越界", 400);
  if (buf.length === 0) throw new AppError("分片内容为空", 400);
  if (buf.length > CHUNK_SIZE + 1024) throw new AppError("分片过大", 413);
  await fs.mkdir(chunkDir(id), { recursive: true });
  await fs.writeFile(path.join(chunkDir(id), `${index}.part`), buf);
  await prisma.uploadSession.update({ where: { id }, data: { updatedAt: new Date() } });
  return { ok: true };
}

// 断点续传查询：已落盘的分片下标
export async function listReceivedChunks(user: User, id: string) {
  const s = await ownSession(id, user);
  return { totalChunks: s.totalChunks, size: s.size, filename: s.filename, received: await listPartIndices(chunkDir(id)) };
}

// 合并入库：流式拼 sha256 + 写合并临时文件（内存恒为单片）
export async function completeChunkUpload(
  user: User,
  id: string,
  visibility: UploadVisibility = "PRIVATE",
  imageMaxBytes = Number.POSITIVE_INFINITY
): Promise<ImageDTO> {
  const s = await ownSession(id, user);
  const have = new Set(await listPartIndices(chunkDir(id)));
  const missing: number[] = [];
  for (let i = 0; i < s.totalChunks; i++) if (!have.has(i)) missing.push(i);
  if (missing.length) {
    throw new AppError(`还有 ${missing.length} 片未上传（第 ${missing[0] + 1} 片起），请续传后再完成`, 400);
  }

  const hash = createHash("sha256");
  let total = 0;
  const mergedPath = path.join(chunkDir(id), "merged.bin");
  const ws = createWriteStream(mergedPath);
  try {
    for (let i = 0; i < s.totalChunks; i++) {
      await new Promise<void>((resolve, reject) => {
        const rs = createReadStream(path.join(chunkDir(id), `${i}.part`));
        rs.on("data", (c: Buffer | string) => {
          const b = typeof c === "string" ? Buffer.from(c) : c;
          total += b.length;
          hash.update(b);
        });
        rs.on("error", (e) => {
          ws.destroy();
          reject(new AppError(`第 ${i + 1} 片不可读，请重新上传该片`, 400));
        });
        rs.on("end", resolve);
        rs.pipe(ws, { end: false });
      });
    }
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.end(resolve);
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("合并分片失败，请重试", 500);
  }
  if (total !== s.size) {
    await cleanupSession(id);
    throw new AppError("合并后大小与声明不符，请重新上传", 400);
  }
  const sha256 = hash.digest("hex");

  // 配额（与普通上传同口径：本地磁盘占用统计）
  const used = Number(await localUsageOf(user.id));
  if (used + total > Number(user.storageQuota)) {
    await cleanupSession(id);
    throw new AppError("存储配额不足，请清理空间或联系管理员", 413);
  }

  // sha256 去重：同用户已有相同内容直接复用记录
  const dup = await prisma.image.findFirst({ where: { userId: user.id, sha256, deletedAt: null } });
  if (dup) {
    await cleanupSession(id);
    if (dup.albumId) return toDTO(dup);
    // 记录尚未归属任何相册 → 挂到本次指定的相册（未指定则归入「我的相册」）
    const albumId = s.albumId ?? (await ensureMyAlbum(user.id)).id;
    const updated = await prisma.image.update({
      where: { id: dup.id },
      data: { albumId },
      include: { user: { select: { name: true } } },
    });
    return toDTO(updated);
  }

  // 魔数判定（读合并文件头 64 字节）：图片全量走处理流水线，视频流式直传存储
  const fh = await fs.open(mergedPath, "r");
  const head = Buffer.alloc(64);
  await fh.read(head, 0, 64, 0);
  await fh.close();

  let processed: Awaited<ReturnType<typeof processAndStoreImage>>;
  if (detectVideoMime(head)) {
    processed = await processAndStoreVideoFile(mergedPath, total, sha256, user.id, s.filename);
  } else if (detectImageMime(head)) {
    // 图片受站点单文件上限约束（视频不限大小，只受存储配额约束）
    if (total > imageMaxBytes) {
      await cleanupSession(id);
      throw new AppError(`图片超过大小上限 ${Math.round(imageMaxBytes / 1024 / 1024)}MB`, 413);
    }
    if (total > IMAGE_BUF_LIMIT) {
      await cleanupSession(id);
      throw new AppError("图片过大（超过 64MB），请压缩后再上传", 413);
    }
    processed = await processAndStoreImage(await fs.readFile(mergedPath), user.id, s.filename);
  } else {
    await cleanupSession(id);
    throw new AppError("不支持的文件格式（仅允许 jpg/png/webp/gif/avif 与 mp4/webm/mov/mkv）", 415);
  }

  // 未指定相册 → 归入默认「我的相册」
  const albumId = s.albumId ?? (await ensureMyAlbum(user.id)).id;
  const img = await prisma.image.create({
    data: {
      userId: user.id,
      filename: processed.filename,
      storageKey: processed.storageKey,
      thumbKey: processed.thumbKey,
      storage: processed.storage,
      mimeType: processed.mimeType,
      size: processed.size,
      width: processed.width,
      height: processed.height,
      sha256: processed.sha256,
      blurhash: processed.blurhash,
      albumId,
      // 默认私有：不进公共画廊；可选友链/公开（公开 = 进画廊候选，普通用户审核通过后才真正展示）
      visibility,
      status: isAdminRole(user.role) ? "PUBLISHED" : "PENDING",
    },
    include: { user: { select: { name: true } } },
  });

  // 普通用户选择公开 = 进画廊申请：邮件提醒管理员审核（失败不影响上传）
  if (visibility === "PUBLIC" && !isAdminRole(user.role)) {
    void notifyAdmins(
      "【ImageHub】新的进画廊申请待审核",
      `${user.name} 上传了「${processed.filename}」并选择公开（进入画廊），请到后台审核。`
    );
  }
  await cleanupSession(id);
  await logActivity(user.id, "upload", "上传了 1 张图片");
  return toDTO(img);
}
