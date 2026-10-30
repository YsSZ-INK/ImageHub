import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import { processAndStoreImage, processAndStoreVideo, detectVideoMime } from "@/lib/image";
import type { User, Image } from "@prisma/client";
import type { z } from "zod";
import type {
  batchActionSchema,
  albumCreateSchema,
  albumUpdateSchema,
} from "@/lib/validation";

export type Viewer = Pick<User, "id" | "role">;

export type ImageDTO = {
  id: string;
  filename: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  kind: "image" | "video";
  visibility: string;
  status: string;
  createdAt: Date;
  blurhash: string | null;
  albumId: string | null;
  thumbUrl: string;
  rawUrl: string;
  ownerName?: string;
};

export function toDTO(img: Image & { user?: { name: string } }): ImageDTO {
  return {
    id: img.id,
    filename: img.filename,
    width: img.width,
    height: img.height,
    size: img.size,
    mimeType: img.mimeType,
    kind: img.mimeType.startsWith("video/") ? "video" : "image",
    visibility: img.visibility,
    status: img.status,
    createdAt: img.createdAt,
    blurhash: img.blurhash,
    albumId: img.albumId,
    thumbUrl: `/api/images/${img.id}/thumb`,
    rawUrl: `/api/images/${img.id}/raw`,
    ownerName: img.user?.name,
  };
}

// ============ 可见性判定 ============
// PUBLIC: 所有用户可见（含未登录，用于外链直链）；UNLISTED: 有链接可见（含未登录），不进列表；PRIVATE: 仅本人/管理员
// PENDING（待审核）：仅本人与管理员可见——匿名外链与其他登录用户都不可见，审核通过后才对公开可见
export function canView(img: Image, viewer: Viewer | null): boolean {
  if (viewer?.role === "ADMIN") return true;
  if (img.userId === viewer?.id) return true;
  if (img.status !== "PUBLISHED") return false;
  return img.visibility === "PUBLIC" || img.visibility === "UNLISTED";
}

// 单张图片访问校验（防 IDOR）
export async function getImageForView(id: string, viewer: Viewer | null, includeDeleted = false) {
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw new AppError("图片不存在", 404);
  if (!includeDeleted && img.deletedAt) throw new AppError("图片不存在", 404);
  if (!canView(img, viewer)) throw new AppError("无权访问该图片", viewer ? 403 : 401);
  return img;
}

// 重新提交审核：仅本人/管理员，图片回到待审核状态（从画廊、公开直链与动态中隐藏）
export async function requestReview(id: string, viewer: Viewer): Promise<ImageDTO> {
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img || img.deletedAt) throw new AppError("图片不存在", 404);
  if (img.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作该图片", 403);
  if (img.status === "PENDING") return toDTO(img);
  return toDTO(await prisma.image.update({ where: { id }, data: { status: "PENDING" } }));
}

// 审核通过（管理员）：待审核图片进入画廊
export async function approveImage(id: string, viewer: Viewer): Promise<ImageDTO> {
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img || img.deletedAt) throw new AppError("图片不存在", 404);
  if (img.status === "PUBLISHED") return toDTO(img);
  return toDTO(await prisma.image.update({ where: { id }, data: { status: "PUBLISHED" } }));
}

// ============ 上传（含配额、去重） ============
export async function uploadImages(
  user: User,
  files: { buf: Buffer; name: string; contentType: string }[],
  opts?: { albumId?: string | null }
): Promise<{ results: (ImageDTO | { name: string; error: string })[]; deduped: number }> {
  const results: (ImageDTO | { name: string; error: string })[] = [];
  let deduped = 0;

  for (const f of files) {
    try {
      const dto = await uploadOne(user, f, opts?.albumId ?? null);
      results.push(dto);
      if ("deduped" in dto && dto.deduped) deduped++;
    } catch (err) {
      console.error("[upload] 单文件处理失败:", f.name, err);
      const msg = err instanceof AppError ? err.message : "处理失败";
      results.push({ name: f.name, error: msg });
    }
  }
  return { results, deduped };
}

// 相册归属校验（上传/更新共用）：相册必须存在且属于本人（管理员可操作任意相册）
export async function assertAlbumAccess(viewer: Viewer, albumId: string | null) {
  if (!albumId) return;
  const album = await prisma.album.findUnique({ where: { id: albumId } });
  if (!album || (album.userId !== viewer.id && viewer.role !== "ADMIN")) {
    throw new AppError("相册不存在或无权访问", 403);
  }
}

async function uploadOne(
  user: User,
  f: { buf: Buffer; name: string; contentType: string },
  albumId: string | null
): Promise<ImageDTO & { deduped?: boolean }> {
  // sha256 去重：同用户重复上传直接复用
  const { createHash } = await import("crypto");
  const sha256 = createHash("sha256").update(f.buf).digest("hex");
  const dup = await prisma.image.findFirst({
    where: { userId: user.id, sha256, deletedAt: null },
  });
  if (dup) {
    // 重复上传复用已有记录；本次指定了相册则把记录挂过去
    if (albumId && dup.albumId !== albumId) {
      const updated = await prisma.image.update({
        where: { id: dup.id },
        data: { albumId },
        include: { user: { select: { name: true } } },
      });
      return { ...toDTO(updated), deduped: true };
    }
    return { ...toDTO(dup), deduped: true };
  }

  // 配额校验
  const used = Number(user.storageUsed);
  const quota = Number(user.storageQuota);
  if (used + f.buf.length > quota) {
    throw new AppError("存储配额不足，请清理空间或联系管理员", 413);
  }

  // 视频（魔数识别）原样存储；图片走处理流水线（缩略图/WebP/blurhash）
  const processed = detectVideoMime(f.buf)
    ? await processAndStoreVideo(f.buf, user.id, f.name)
    : await processAndStoreImage(f.buf, user.id, f.name);
  const [img] = await prisma.$transaction([
    prisma.image.create({
      data: {
        userId: user.id,
        filename: processed.filename,
        storageKey: processed.storageKey,
        thumbKey: processed.thumbKey,
        mimeType: processed.mimeType,
        size: processed.size,
        width: processed.width,
        height: processed.height,
        sha256: processed.sha256,
        blurhash: processed.blurhash,
        albumId,
        // 管理员上传免审核直接发布；普通用户上传进入待审核队列
        status: user.role === "ADMIN" ? "PUBLISHED" : "PENDING",
      },
      include: { user: { select: { name: true } } },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { storageUsed: { increment: BigInt(processed.size) } },
    }),
  ]);
  return toDTO(img);
}

// ============ 列表 ============
export type ListParams = {
  viewer: Viewer;
  scope: "gallery" | "mine" | "trash" | "album" | "user" | "admin";
  albumId?: string;
  username?: string;
  sort?: "newest" | "oldest" | "largest";
  cursor?: string;
  take?: number;
};

export async function listImages(p: ListParams): Promise<{ items: ImageDTO[]; nextCursor: string | null }> {
  const take = Math.min(p.take ?? 24, 60);
  const where: Record<string, unknown> = {};

  switch (p.scope) {
    case "gallery":
      // 公共画廊：所有用户的 PUBLIC 且已通过审核的图片
      where.visibility = "PUBLIC";
      where.status = "PUBLISHED";
      where.deletedAt = null;
      break;
    case "mine":
      where.userId = p.viewer.id;
      where.deletedAt = null;
      break;
    case "trash":
      where.userId = p.viewer.id;
      where.deletedAt = { not: null };
      break;
    case "album": {
      if (!p.albumId) throw new AppError("缺少相册参数", 400);
      const album = await prisma.album.findUnique({ where: { id: p.albumId } });
      if (!album) throw new AppError("相册不存在", 404);
      const isOwner = album.userId === p.viewer.id || p.viewer.role === "ADMIN";
      if (!isOwner && album.visibility !== "PUBLIC") throw new AppError("无权访问该相册", 403);
      where.albumId = p.albumId;
      where.deletedAt = null;
      // 相册内按可见性过滤（非拥有者：仅公开且已过审）
      if (!isOwner) {
        where.visibility = "PUBLIC";
        where.status = "PUBLISHED";
      }
      break;
    }
    case "user": {
      if (!p.username) throw new AppError("缺少用户名", 400);
      const target = await prisma.user.findUnique({ where: { name: p.username } });
      if (!target) throw new AppError("用户不存在", 404);
      where.userId = target.id;
      where.deletedAt = null;
      if (target.id !== p.viewer.id && p.viewer.role !== "ADMIN") {
        where.visibility = "PUBLIC";
        where.status = "PUBLISHED";
      }
      break;
    }
    case "admin":
      // 管理员全站列表
      if (p.viewer.role !== "ADMIN") throw new AppError("无权限", 403);
      where.deletedAt = null;
      break;
  }

  const orderBy =
    p.sort === "oldest" ? { createdAt: "asc" as const }
    : p.sort === "largest" ? { size: "desc" as const }
    : { createdAt: "desc" as const };

  const rows = await prisma.image.findMany({
    where,
    orderBy,
    take: take + 1,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
    include: { user: { select: { name: true } } },
  });

  const hasMore = rows.length > take;
  const items = rows.slice(0, take).map(toDTO);
  return { items, nextCursor: hasMore ? rows[take - 1].id : null };
}

// ============ 单图详情 / 更新 / 删除 ============
export async function getImageDetail(id: string, viewer: Viewer | null) {
  const img = await getImageForView(id, viewer);
  const full = await prisma.image.findUnique({
    where: { id },
    include: { user: { select: { name: true } } },
  });
  return full ? toDTO(full) : toDTO(img);
}

async function assertOwnership(id: string, viewer: Viewer) {
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw new AppError("图片不存在", 404);
  if (img.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作该图片", 403);
  return img;
}

export async function updateImage(id: string, viewer: Viewer, data: { filename?: string; visibility?: string; albumId?: string | null }) {
  await assertOwnership(id, viewer);
  if (data.albumId) {
    const album = await prisma.album.findUnique({ where: { id: data.albumId } });
    if (!album || (album.userId !== viewer.id && viewer.role !== "ADMIN")) {
      throw new AppError("相册不存在或无权访问", 403);
    }
  }
  const img = await prisma.image.update({
    where: { id },
    data: { filename: data.filename, visibility: data.visibility, albumId: data.albumId },
    include: { user: { select: { name: true } } },
  });
  return toDTO(img);
}

// 软删除 → 回收站
export async function softDeleteImage(id: string, viewer: Viewer) {
  await assertOwnership(id, viewer);
  await clearAlbumCovers([id]);
  return prisma.image.update({ where: { id }, data: { deletedAt: new Date() } });
}

// 封面图被移出相册/删除后，清空引用它的相册封面（excludeAlbumId 用于图片仍在目标相册内的情形）
async function clearAlbumCovers(imageIds: string[], excludeAlbumId?: string) {
  await prisma.album.updateMany({
    where: {
      coverImageId: { in: imageIds },
      ...(excludeAlbumId ? { id: { not: excludeAlbumId } } : {}),
    },
    data: { coverImageId: null },
  });
}

export async function restoreImage(id: string, viewer: Viewer) {
  await assertOwnership(id, viewer);
  return prisma.image.update({ where: { id }, data: { deletedAt: null } });
}

// 彻底删除：同时删除存储对象、扣减配额
export async function purgeImage(id: string, viewer: Viewer) {
  const img = await assertOwnership(id, viewer);
  const storage = await getStorage();
  await clearAlbumCovers([id]);
  await prisma.image.delete({ where: { id } });
  await Promise.allSettled([storage.delete(img.storageKey), storage.delete(img.thumbKey)]);
  await prisma.user.update({
    where: { id: img.userId },
    data: { storageUsed: { decrement: BigInt(img.size) } },
  });
}

// 清理超过 30 天的回收站（懒执行）
export async function purgeExpiredTrash() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  const expired = await prisma.image.findMany({ where: { deletedAt: { lt: cutoff } } });
  const viewer = { id: "system", role: "ADMIN" };
  for (const img of expired) {
    await purgeImage(img.id, viewer).catch(() => {});
  }
}

// ============ 批量操作 ============
export async function batchImages(viewer: Viewer, input: z.infer<typeof batchActionSchema>) {
  const { ids, action } = input;
  // 归属校验：仅能操作自己的图片（管理员除外）
  const owned = await prisma.image.findMany({
    where: { id: { in: ids }, ...(viewer.role === "ADMIN" ? {} : { userId: viewer.id }) },
  });
  if (owned.length === 0) throw new AppError("没有可操作的图片", 404);

  switch (action) {
    case "delete":
      await clearAlbumCovers(owned.map((i) => i.id));
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      break;
    case "restore":
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) }, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      break;
    case "purge":
      for (const img of owned) await purgeImage(img.id, viewer);
      break;
    case "visibility":
      if (!input.visibility) throw new AppError("缺少可见性参数", 400);
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) } },
        data: { visibility: input.visibility },
      });
      break;
    case "album":
      if (input.albumId) {
        const album = await prisma.album.findUnique({ where: { id: input.albumId } });
        if (!album || (album.userId !== viewer.id && viewer.role !== "ADMIN")) {
          throw new AppError("相册不存在或无权访问", 403);
        }
      }
      // 图片被移出原相册（或移往别的相册）时，清空原相册对它们的封面引用
      await clearAlbumCovers(owned.map((i) => i.id), input.albumId ?? undefined);
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) } },
        data: { albumId: input.albumId ?? null },
      });
      break;
  }
  return { affected: owned.length };
}

// ============ 相册 ============
export function makeSlug(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "album";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listAlbums(viewer: Viewer, username?: string) {
  let userId: string | undefined;
  if (username) {
    const target = await prisma.user.findUnique({ where: { name: username } });
    if (!target) throw new AppError("用户不存在", 404);
    userId = target.id;
  }
  const albums = await prisma.album.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(userId && userId !== viewer.id && viewer.role !== "ADMIN" ? { visibility: "PUBLIC" } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { images: { where: { deletedAt: null } } } },
    },
  });
  // 视频没有缩略图，封面若指向视频则回退为占位
  const coverIds = albums.map((a) => a.coverImageId).filter((x): x is string => Boolean(x));
  const coverRows = coverIds.length
    ? await prisma.image.findMany({ where: { id: { in: coverIds } }, select: { id: true, mimeType: true } })
    : [];
  const videoCovers = new Set(coverRows.filter((i) => i.mimeType.startsWith("video/")).map((i) => i.id));
  return albums.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    slug: a.slug,
    visibility: a.visibility,
    coverImageId: a.coverImageId,
    imageCount: a._count.images,
    createdAt: a.createdAt,
    coverUrl: a.coverImageId && !videoCovers.has(a.coverImageId) ? `/api/images/${a.coverImageId}/thumb` : null,
  }));
}

export async function createAlbum(viewer: Viewer, input: z.infer<typeof albumCreateSchema>) {
  return prisma.album.create({
    data: { userId: viewer.id, name: input.name, description: input.description, slug: makeSlug(input.name), visibility: input.visibility },
  });
}

export async function updateAlbum(id: string, viewer: Viewer, input: z.infer<typeof albumUpdateSchema>) {
  const album = await prisma.album.findUnique({ where: { id } });
  if (!album) throw new AppError("相册不存在", 404);
  if (album.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作", 403);
  if (input.coverImageId != null) {
    const img = await prisma.image.findUnique({ where: { id: input.coverImageId } });
    if (!img || img.albumId !== id) throw new AppError("封面图片必须属于该相册", 400);
  }
  return prisma.album.update({ where: { id }, data: input });
}

export async function deleteAlbum(id: string, viewer: Viewer) {
  const album = await prisma.album.findUnique({ where: { id } });
  if (!album) throw new AppError("相册不存在", 404);
  if (album.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作", 403);
  await prisma.album.delete({ where: { id } }); // images.albumId SetNull
}

export async function getAlbumForView(idOrSlug: string, viewer: Viewer) {
  const album = await prisma.album.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      user: { select: { name: true } },
      _count: { select: { images: { where: { deletedAt: null } } } },
    },
  });
  if (!album) throw new AppError("相册不存在", 404);
  const isOwner = album.userId === viewer.id || viewer.role === "ADMIN";
  if (!isOwner && album.visibility !== "PUBLIC") throw new AppError("无权访问该相册", 403);
  return { ...album, imageCount: album._count.images };
}
