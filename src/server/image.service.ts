import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import { processAndStoreImage } from "@/lib/image";
import type { User, Image } from "@prisma/client";
import type { z } from "zod";
import type {
  batchActionSchema,
  albumCreateSchema,
  albumUpdateSchema,
  tagCreateSchema,
} from "@/lib/validation";

export type Viewer = Pick<User, "id" | "role">;

export type ImageDTO = {
  id: string;
  filename: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  visibility: string;
  createdAt: Date;
  blurhash: string | null;
  albumId: string | null;
  thumbUrl: string;
  rawUrl: string;
  ownerName?: string;
  tags?: { id: string; name: string }[];
};

function toDTO(img: Image & { user?: { name: string }; tags?: { tag: { id: string; name: string } }[] }): ImageDTO {
  return {
    id: img.id,
    filename: img.filename,
    width: img.width,
    height: img.height,
    size: img.size,
    mimeType: img.mimeType,
    visibility: img.visibility,
    createdAt: img.createdAt,
    blurhash: img.blurhash,
    albumId: img.albumId,
    thumbUrl: `/api/images/${img.id}/thumb`,
    rawUrl: `/api/images/${img.id}/raw`,
    ownerName: img.user?.name,
    tags: img.tags?.map((it) => it.tag),
  };
}

// ============ 可见性判定（严格私有：仅登录用户可见） ============
// PUBLIC: 所有登录用户可见；UNLISTED: 登录用户有链接可见，不进列表；PRIVATE: 仅本人/管理员
export function canView(img: Image, viewer: Viewer | null): boolean {
  if (!viewer) return false; // 未登录一律不可见
  if (viewer.role === "ADMIN") return true;
  if (img.userId === viewer.id) return true;
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

// ============ 上传（含配额、去重） ============
export async function uploadImages(
  user: User,
  files: { buf: Buffer; name: string; contentType: string }[]
): Promise<{ results: (ImageDTO | { name: string; error: string })[]; deduped: number }> {
  const results: (ImageDTO | { name: string; error: string })[] = [];
  let deduped = 0;

  for (const f of files) {
    try {
      const dto = await uploadOne(user, f);
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

// 按名称为一批图片关联标签（不存在则创建，最多 10 个、单个 ≤30 字）；仅处理归属当前用户的图片
export async function attachTagsByName(userId: string, imageIds: string[], names: string[]) {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n && n.length <= 30))].slice(0, 10);
  if (clean.length === 0 || imageIds.length === 0) return;
  for (const name of clean) {
    const tag = await prisma.tag.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
    });
    for (const imageId of imageIds) {
      const owned = await prisma.image.findFirst({ where: { id: imageId, userId }, select: { id: true } });
      if (!owned) continue;
      await prisma.imageTag.upsert({
        where: { imageId_tagId: { imageId, tagId: tag.id } },
        update: {},
        create: { imageId, tagId: tag.id },
      });
    }
  }
}

async function uploadOne(
  user: User,
  f: { buf: Buffer; name: string; contentType: string }
): Promise<ImageDTO & { deduped?: boolean }> {
  // sha256 去重：同用户重复上传直接复用
  const { createHash } = await import("crypto");
  const sha256 = createHash("sha256").update(f.buf).digest("hex");
  const dup = await prisma.image.findFirst({
    where: { userId: user.id, sha256, deletedAt: null },
  });
  if (dup) return { ...toDTO(dup), deduped: true };

  // 配额校验
  const used = Number(user.storageUsed);
  const quota = Number(user.storageQuota);
  if (used + f.buf.length > quota) {
    throw new AppError("存储配额不足，请清理空间或联系管理员", 413);
  }

  const processed = await processAndStoreImage(f.buf, user.id, f.name);
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
      },
      include: { user: { select: { name: true } }, tags: { include: { tag: true } } },
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
  tag?: string;
  sort?: "newest" | "oldest" | "largest";
  cursor?: string;
  take?: number;
};

export async function listImages(p: ListParams): Promise<{ items: ImageDTO[]; nextCursor: string | null }> {
  const take = Math.min(p.take ?? 24, 60);
  const where: Record<string, unknown> = {};

  switch (p.scope) {
    case "gallery":
      // 公共画廊：所有用户的 PUBLIC 图片
      where.visibility = "PUBLIC";
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
      // 相册内按可见性过滤（非拥有者）
      if (!isOwner) where.visibility = "PUBLIC";
      break;
    }
    case "user": {
      if (!p.username) throw new AppError("缺少用户名", 400);
      const target = await prisma.user.findUnique({ where: { name: p.username } });
      if (!target) throw new AppError("用户不存在", 404);
      where.userId = target.id;
      where.deletedAt = null;
      if (target.id !== p.viewer.id && p.viewer.role !== "ADMIN") where.visibility = "PUBLIC";
      break;
    }
    case "admin":
      // 管理员全站列表
      if (p.viewer.role !== "ADMIN") throw new AppError("无权限", 403);
      where.deletedAt = null;
      break;
  }

  // 标签筛选
  if (p.tag) {
    where.tags = { some: { tag: { name: p.tag } } };
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
    include: { user: { select: { name: true } }, tags: { include: { tag: true } } },
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
    include: { user: { select: { name: true } }, tags: { include: { tag: true } } },
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
    include: { user: { select: { name: true } }, tags: { include: { tag: true } } },
  });
  return toDTO(img);
}

// 软删除 → 回收站
export async function softDeleteImage(id: string, viewer: Viewer) {
  await assertOwnership(id, viewer);
  return prisma.image.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function restoreImage(id: string, viewer: Viewer) {
  await assertOwnership(id, viewer);
  return prisma.image.update({ where: { id }, data: { deletedAt: null } });
}

// 彻底删除：同时删除存储对象、扣减配额
export async function purgeImage(id: string, viewer: Viewer) {
  const img = await assertOwnership(id, viewer);
  const storage = await getStorage();
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
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) } },
        data: { albumId: input.albumId ?? null },
      });
      break;
    case "tag": {
      if (!input.tagId) throw new AppError("缺少标签参数", 400);
      const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
      if (!tag || (tag.userId !== viewer.id && viewer.role !== "ADMIN")) {
        throw new AppError("标签不存在", 403);
      }
      for (const img of owned) {
        await prisma.imageTag.upsert({
          where: { imageId_tagId: { imageId: img.id, tagId: tag.id } },
          create: { imageId: img.id, tagId: tag.id },
          update: {},
        });
      }
      break;
    }
    case "untag": {
      if (!input.tagId) throw new AppError("缺少标签参数", 400);
      await prisma.imageTag.deleteMany({
        where: { tagId: input.tagId, imageId: { in: owned.map((i) => i.id) } },
      });
      break;
    }
  }
  return { affected: owned.length };
}

// ============ 相册 ============
function makeSlug(name: string) {
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
  return albums.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    slug: a.slug,
    visibility: a.visibility,
    coverImageId: a.coverImageId,
    imageCount: a._count.images,
    createdAt: a.createdAt,
    coverUrl: a.coverImageId ? `/api/images/${a.coverImageId}/thumb` : null,
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
  if (input.coverImageId) {
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
    include: { user: { select: { name: true } } },
  });
  if (!album) throw new AppError("相册不存在", 404);
  const isOwner = album.userId === viewer.id || viewer.role === "ADMIN";
  if (!isOwner && album.visibility !== "PUBLIC") throw new AppError("无权访问该相册", 403);
  return album;
}

// ============ 标签 ============
export async function listTags(viewer: Viewer, username?: string) {
  let userId: string | undefined;
  if (username) {
    const target = await prisma.user.findUnique({ where: { name: username } });
    if (!target) throw new AppError("用户不存在", 404);
    userId = target.id;
  }
  const tags = await prisma.tag.findMany({
    where: userId ? { userId } : {},
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { imageTag: true } } },
  });
  return tags.map((t) => ({ id: t.id, name: t.name, imageCount: t._count.imageTag }));
}

export async function createTag(viewer: Viewer, input: z.infer<typeof tagCreateSchema>) {
  const exists = await prisma.tag.findFirst({ where: { userId: viewer.id, name: input.name } });
  if (exists) return exists;
  return prisma.tag.create({ data: { userId: viewer.id, name: input.name } });
}

export async function updateTag(id: string, viewer: Viewer, name: string) {
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) throw new AppError("标签不存在", 404);
  if (tag.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作", 403);
  return prisma.tag.update({ where: { id }, data: { name } });
}

export async function deleteTag(id: string, viewer: Viewer) {
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) throw new AppError("标签不存在", 404);
  if (tag.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作", 403);
  await prisma.tag.delete({ where: { id } });
}
