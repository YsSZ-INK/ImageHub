// 分片上传服务：大文件切片上传（init → 逐片 PUT → complete 合并入库）
// 会话元数据存 UploadSession 表，分片数据落盘 storage/.chunks/{id}/{i}.part
// 内存占用恒为单片（5MB）：合并阶段流式算 sha256 并拼接，视频流式入存储，图片全量走处理流水线
import { promises as fs, createReadStream, createWriteStream } from "fs";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { storageRoot } from "@/lib/storage/local";
import { processAndStoreImage, processAndStoreVideoFile, detectImageMime, detectVideoMime } from "@/lib/image";
import { localUsageOf } from "@/server/storage-stats";
import { toDTO, type ImageDTO } from "./image.service";
import type { User } from "@prisma/client";

// 与前端切片大小保持一致
export const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CHUNKS = 2000;
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

// 创建会话：校验大小上限与分片数自洽，建分片目录
export async function initChunkUpload(
  user: User,
  input: { filename: string; size: number; mimeType: string; totalChunks: number; albumId?: string | null },
  maxBytes: number
) {
  if (!(input.size > 0) || input.size > maxBytes) {
    throw new AppError(`文件大小超出上限 ${Math.round(maxBytes / 1024 / 1024)}MB`, 413);
  }
  if (!Number.isInteger(input.totalChunks) || input.totalChunks < 1 || input.totalChunks > MAX_CHUNKS) {
    throw new AppError("分片数不合法", 400);
  }
  if (input.totalChunks !== Math.ceil(input.size / CHUNK_SIZE)) {
    throw new AppError("分片数与文件大小不匹配", 400);
  }
  await cleanupExpiredSessions();
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
export async function completeChunkUpload(user: User, id: string): Promise<ImageDTO> {
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
    if (s.albumId && dup.albumId !== s.albumId) {
      const updated = await prisma.image.update({
        where: { id: dup.id },
        data: { albumId: s.albumId },
        include: { user: { select: { name: true } } },
      });
      return toDTO(updated);
    }
    return toDTO(dup);
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
    if (total > IMAGE_BUF_LIMIT) {
      await cleanupSession(id);
      throw new AppError("图片过大（超过 64MB），请压缩后再上传", 413);
    }
    processed = await processAndStoreImage(await fs.readFile(mergedPath), user.id, s.filename);
  } else {
    await cleanupSession(id);
    throw new AppError("不支持的文件格式（仅允许 jpg/png/webp/gif/avif 与 mp4/webm/mov/mkv）", 415);
  }

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
      albumId: s.albumId,
      status: user.role === "ADMIN" ? "PUBLISHED" : "PENDING",
    },
    include: { user: { select: { name: true } } },
  });

  await cleanupSession(id);
  return toDTO(img);
}
