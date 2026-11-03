import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isAdminRole, isSuper } from "@/lib/roles";
import { cachedJson, invalidateJson } from "@/lib/cache";
import { logActivity } from "@/server/audit.service";
import { notifyAdmins } from "@/lib/mailer";
import { hasAccessTo } from "@/server/access.service";
import { getStorageFor } from "@/lib/storage";
import { processAndStoreImage, processAndStoreVideo, processAndStoreVideoFile, detectVideoMime } from "@/lib/image";
import { localUsageOf } from "@/server/storage-stats";
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
  storage: string;
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
    storage: img.storage,
    thumbUrl: `/api/images/${img.id}/thumb`,
    rawUrl: `/api/images/${img.id}/raw`,
    ownerName: img.user?.name,
  };
}

// ============ 可见性判定 ============
// PUBLIC: 所有用户可见（含未登录，可作免登录外链）；UNLISTED（友链）: 登录任意账户即可见，不进列表；
// PRIVATE: 仅本人/超级管理员
// PENDING（待审核）：本人、两级管理员可见（管理员需看到待审队列）——匿名外链与其他登录用户都不可见
export function canView(img: Image, viewer: Viewer | null): boolean {
  if (!viewer) {
    // 匿名访客：仅公开且已过审
    return img.status === "PUBLISHED" && img.visibility === "PUBLIC";
  }
  if (isSuper(viewer.role)) return true; // 超级管理员可见全部
  if (img.userId === viewer.id) return true;
  if (isAdminRole(viewer.role) && img.status === "PENDING") return true; // 管理员审核需要
  if (img.status !== "PUBLISHED") return false;
  if (img.visibility === "PUBLIC") return true;
  // 友链：登录任意账户即可见（未登录访客不可见）
  return img.visibility === "UNLISTED";
}

// 单张图片访问校验（防 IDOR）。PRIVATE/PENDING 之外再放宽一档：
// 已获图片主人授权（申请-审批通过）的登录用户可浏览其全部「已发布」图片（含 PRIVATE；待审核仍不可见）
export async function getImageForView(id: string, viewer: Viewer | null, includeDeleted = false) {
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw new AppError("图片不存在", 404);
  if (!includeDeleted && img.deletedAt) throw new AppError("图片不存在", 404);
  if (!canView(img, viewer)) {
    const granted =
      !!viewer &&
      img.status === "PUBLISHED" &&
      !isSuper(viewer.role) &&
      img.userId !== viewer.id &&
      (await hasAccessTo(viewer.id, img.userId));
    if (!granted) throw new AppError("无权访问该图片", viewer ? 403 : 401);
  }
  return img;
}

// 直链文件服务所需的字段快照（raw/thumb 高频读缓存的值类型）
export type PublicImageSnapshot = Pick<Image, "id" | "mimeType" | "storage" | "storageKey" | "thumbKey" | "filename">;

// 匿名直链快速路径：缓存「匿名可见」图片行（已发布 + 公开），raw/thumb 免查库直出。
// Redis 30 秒 / 进程内存兜底；友链需登录（不缓存）、私有/审核中/已删除不缓存，每次走完整校验。
// 所有图片行变更入口用 invalidateImageView 主动失效，TTL 兜底。
export async function getImageForPublicView(id: string): Promise<PublicImageSnapshot | null> {
  const snap = await cachedJson<PublicImageSnapshot>(`imgview:${id}`, 30_000, async () => {
    const img = await prisma.image.findUnique({
      where: { id },
      select: {
        id: true,
        mimeType: true,
        storage: true,
        storageKey: true,
        thumbKey: true,
        filename: true,
        visibility: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!img || img.deletedAt || img.status !== "PUBLISHED" || img.visibility !== "PUBLIC") {
      return undefined; // 非匿名可见（友链需登录）：不缓存
    }
    const { visibility: _v, status: _s, deletedAt: _d, ...snap } = img;
    return snap;
  });
  return snap ?? null;
}

// 图片行变更后失效直链缓存（改可见性/审核/删除/恢复/移动相册/迁移存储等入口调用）
export async function invalidateImageView(...ids: string[]) {
  if (ids.length === 0) return;
  await invalidateJson(...ids.map((id) => `imgview:${id}`));
}

// 审核通过（管理员）：待审核图片进入画廊
export async function approveImage(id: string, viewer: Viewer): Promise<ImageDTO> {
  if (!isAdminRole(viewer.role)) throw new AppError("无权限", 403);
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img || img.deletedAt) throw new AppError("图片不存在", 404);
  if (img.status === "PUBLISHED") return toDTO(img);
  const updated = await prisma.image.update({ where: { id }, data: { status: "PUBLISHED" } });
  await invalidateImageView(id);
  return toDTO(updated);
}

// ============ 上传（含配额、去重） ============
// 默认相册「我的相册」：懒创建，未指定相册的上传自动归入
export const MY_ALBUM_NAME = "我的相册";

// 上传可见性：默认私有（不进画廊）；友链 = 登录用户可见；公开 = 进画廊候选（普通用户仍需审核）
export type UploadVisibility = "PRIVATE" | "UNLISTED" | "PUBLIC";
export function normalizeUploadVisibility(v: unknown): UploadVisibility {
  return v === "UNLISTED" || v === "PUBLIC" ? v : "PRIVATE";
}

export async function ensureMyAlbum(userId: string) {
  const existing = await prisma.album.findFirst({
    where: { userId, name: MY_ALBUM_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.album.create({
    data: {
      userId,
      name: MY_ALBUM_NAME,
      slug: makeSlug(MY_ALBUM_NAME),
      visibility: "PRIVATE",
      description: "上传的图片默认存放于此",
    },
  });
}

export async function uploadImages(
  user: User,
  files: { buf: Buffer; name: string; contentType: string }[],
  opts?: { albumId?: string | null; visibility?: UploadVisibility }
): Promise<{ results: (ImageDTO | { name: string; error: string })[]; deduped: number }> {
  const results: (ImageDTO | { name: string; error: string })[] = [];
  let deduped = 0;
  // 未指定相册 → 归入「我的相册」（整批只解析一次）
  const targetAlbumId = opts?.albumId ?? (await ensureMyAlbum(user.id)).id;

  for (const f of files) {
    try {
      const dto = await uploadOne(user, f, targetAlbumId, opts?.visibility);
      results.push(dto);
      if ("deduped" in dto && dto.deduped) deduped++;
    } catch (err) {
      console.error("[upload] 单文件处理失败:", f.name, err);
      const msg = err instanceof AppError ? err.message : "处理失败";
      results.push({ name: f.name, error: msg });
    }
  }
  const okCount = results.filter((r) => !("error" in r)).length;
  if (okCount > 0) await logActivity(user.id, "upload", `上传了 ${okCount} 张图片`);
  return { results, deduped };
}

// 相册归属校验（上传/更新共用）：相册必须存在且属于本人（仅超级管理员可操作任意相册）
export async function assertAlbumAccess(viewer: Viewer, albumId: string | null) {
  if (!albumId) return;
  const album = await prisma.album.findUnique({ where: { id: albumId } });
  if (!album || (album.userId !== viewer.id && !isSuper(viewer.role))) {
    throw new AppError("相册不存在或无权访问", 403);
  }
}

async function uploadOne(
  user: User,
  f: { buf: Buffer; name: string; contentType: string },
  albumId: string | null,
  visibility: UploadVisibility = "PRIVATE"
): Promise<ImageDTO & { deduped?: boolean }> {
  // sha256 去重：同用户重复上传直接复用
  const { createHash } = await import("crypto");
  const sha256 = createHash("sha256").update(f.buf).digest("hex");
  const dup = await prisma.image.findFirst({
    where: { userId: user.id, sha256, deletedAt: null },
  });
  if (dup) {
    // 重复上传复用已有记录；记录尚未归属任何相册时挂到本次指定的相册（不抢已归档图片的归属）
    if (albumId && !dup.albumId) {
      const updated = await prisma.image.update({
        where: { id: dup.id },
        data: { albumId },
        include: { user: { select: { name: true } } },
      });
      return { ...toDTO(updated), deduped: true };
    }
    return { ...toDTO(dup), deduped: true };
  }

  // 配额校验（口径：仅统计本地磁盘占用，见 storage-stats.ts）
  const used = Number(await localUsageOf(user.id));
  const quota = Number(user.storageQuota);
  if (used + f.buf.length > quota) {
    throw new AppError("存储配额不足，请清理空间或联系管理员", 413);
  }

  // 视频（魔数识别）原样存储；图片走处理流水线（缩略图/WebP/blurhash）
  const processed = detectVideoMime(f.buf)
    ? await processAndStoreVideo(f.buf, user.id, f.name)
    : await processAndStoreImage(f.buf, user.id, f.name);
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
  // 按存储位置过滤（local / r2:<下标> / r2 / r2b），我的照片筛选用
  storage?: string;
  // 日常记录筛选：按上传者用户名（管理员）与上传时间范围，可组合可单独使用
  owner?: string;
  from?: Date;
  to?: Date;
  // 日常记录（虚拟相册）：仅统计图文动态关联的图片
  posted?: boolean;
};

export async function listImages(p: ListParams): Promise<{ items: ImageDTO[]; nextCursor: string | null; total: number }> {
  const take = Math.min(p.take ?? 24, 60);
  const where: Record<string, unknown> = {};

  switch (p.scope) {
    case "gallery":
      // 公共画廊：所有用户的 PUBLIC 且已通过审核的图片。
      // 图文动态的照片统一归到「日常记录」，不在画廊重复出现（动态删除后 postId 置空即回归画廊）
      where.visibility = "PUBLIC";
      where.status = "PUBLISHED";
      where.deletedAt = null;
      where.postId = null;
      break;
    case "mine":
      where.userId = p.viewer.id;
      where.deletedAt = null;
      // 图文动态的照片只在动态与本机 feed 里展示，不混进「我的图片」
      where.postId = null;
      break;
    case "trash":
      where.userId = p.viewer.id;
      where.deletedAt = { not: null };
      break;
    case "album": {
      if (!p.albumId) throw new AppError("缺少相册参数", 400);
      const album = await prisma.album.findUnique({ where: { id: p.albumId } });
      if (!album) throw new AppError("相册不存在", 404);
      const isOwner = album.userId === p.viewer.id || isSuper(p.viewer.role);
      if (!isOwner && album.visibility !== "PUBLIC") throw new AppError("无权访问该相册", 403);
      where.albumId = p.albumId;
      where.deletedAt = null;
      // 动态照片统一归「日常记录」，不出现在任何相册视图（兼容尚未移出相册的旧数据）
      where.postId = null;
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
      // 用户主页只展示上传的图片：动态照片统一归「日常记录」，不在主页重复出现
      where.postId = null;
      if (target.id !== p.viewer.id && !isSuper(p.viewer.role)) {
        // 已获授权（申请-审批通过）：可见对方全部已发布图片（含 PRIVATE）；否则仅公开
        const granted = await hasAccessTo(p.viewer.id, target.id);
        if (granted) {
          where.status = "PUBLISHED";
        } else {
          where.visibility = "PUBLIC";
          where.status = "PUBLISHED";
        }
      }
      break;
    }
    case "admin":
      // 管理员全站列表：超级管理员看全部；
      // 普通管理员仅放行日常记录（posted=1，动态关联的公开图片），不能翻全站私有/待审内容
      if (!isAdminRole(p.viewer.role)) throw new AppError("无权限", 403);
      where.deletedAt = null;
      if (!isSuper(p.viewer.role)) {
        if (!p.posted) throw new AppError("无权限", 403);
        where.visibility = "PUBLIC";
        where.status = "PUBLISHED";
      }
      break;
  }

  // 排序追加 id 决胜：createdAt 相同的记录（批量上传/同步收录常见）顺序必须稳定，
  // 否则游标翻页在并列行上不确定，同一张照片会跨页重复出现
  const orderBy =
    p.sort === "oldest" ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
    : p.sort === "largest" ? [{ size: "desc" as const }, { id: "desc" as const }]
    : [{ createdAt: "desc" as const }, { id: "desc" as const }];

  // 日常记录筛选：按上传者用户名 + 上传时间范围（可组合、可单独使用；用户名不存在时结果为空）
  if (p.owner) where.user = { name: p.owner };
  if (p.posted) where.postId = { not: null };
  if (p.from || p.to) {
    where.createdAt = {
      ...(p.from ? { gte: p.from } : {}),
      ...(p.to ? { lte: p.to } : {}),
    };
  }

  if (p.storage) {
    if (!/^(local|r2(:\d+)?|r2b)$/.test(p.storage)) throw new AppError("无效的存储位置", 400);
    where.storage = p.storage;
  }

  const [rows, total] = await Promise.all([
    prisma.image.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
      include: { user: { select: { name: true } } },
    }),
    prisma.image.count({ where }), // 总数：前端据此显示「共 N 页」
  ]);

  const hasMore = rows.length > take;
  const items = rows.slice(0, take).map(toDTO);
  return { items, nextCursor: hasMore ? rows[take - 1].id : null, total };
}

// 「我的图片」跨页全选：返回当前筛选（可选按存储位置）下全部未删除图片的 id
export async function listMyImageIds(viewer: Viewer, storage?: string) {
  const where: Record<string, unknown> = { userId: viewer.id, deletedAt: null, postId: null };
  if (storage) {
    if (!/^(local|r2(:\d+)?|r2b)$/.test(storage)) throw new AppError("无效的存储位置", 400);
    where.storage = storage;
  }
  const rows = await prisma.image.findMany({
    where,
    select: { id: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10000,
  });
  return { ids: rows.map((r) => r.id) };
}

// 回收站跨页全选：返回本人回收站内全部图片 id
export async function listTrashedImageIds(viewer: Viewer) {
  const rows = await prisma.image.findMany({
    where: { userId: viewer.id, deletedAt: { not: null } },
    select: { id: true },
    orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
    take: 10000,
  });
  return { ids: rows.map((r) => r.id) };
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
  if (img.userId !== viewer.id && !isSuper(viewer.role)) throw new AppError("无权操作该图片", 403);
  return img;
}

export async function updateImage(id: string, viewer: Viewer, data: { filename?: string; visibility?: string; albumId?: string | null }) {
  const old = await assertOwnership(id, viewer);
  if (data.albumId) {
    const album = await prisma.album.findUnique({ where: { id: data.albumId } });
    if (!album || (album.userId !== viewer.id && !isSuper(viewer.role))) {
      throw new AppError("相册不存在或无权访问", 403);
    }
  }
  const img = await prisma.image.update({
    where: { id },
    data: { filename: data.filename, visibility: data.visibility, albumId: data.albumId },
    include: { user: { select: { name: true } } },
  });
  await invalidateImageView(id);
  // 「进入画廊」等可见性变更写入日志
  if (data.visibility && data.visibility !== old.visibility) {
    await logActivity(viewer.id, "visibility", `把「${img.filename}」设为${VIS_TEXT[data.visibility] ?? data.visibility}`);
  }
  return toDTO(img);
}

// 软删除 → 回收站
export async function softDeleteImage(id: string, viewer: Viewer) {
  await assertOwnership(id, viewer);
  await clearAlbumCovers([id]);
  const img = await prisma.image.update({ where: { id }, data: { deletedAt: new Date() } });
  await invalidateImageView(id);
  return img;
}

// 封面图被移出相册/删除后，清空引用它的相册封面（excludeAlbumId 用于图片仍在目标相册内的情形）
export async function clearAlbumCovers(imageIds: string[], excludeAlbumId?: string) {
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
  const img = await prisma.image.update({ where: { id }, data: { deletedAt: null } });
  await invalidateImageView(id);
  return img;
}

// 彻底删除：同时删除存储对象（按记录的实际存放位置）；配额为实时聚合，无需扣减
export async function purgeImage(id: string, viewer: Viewer) {
  const img = await assertOwnership(id, viewer);
  const storage = await getStorageFor(img.storage);
  await clearAlbumCovers([id]);
  await prisma.image.delete({ where: { id } });
  await invalidateImageView(id);
  // 存储对象删除失败不阻塞记录删除，但要留日志：残留对象可在「站点设置 → 桶内多余文件核对」中清理
  const removed = await Promise.allSettled([storage.delete(img.storageKey), storage.delete(img.thumbKey)]);
  for (const r of removed) if (r.status === "rejected") console.error("[storage] 删除存储对象失败:", r.reason);
}

// 清理超过 30 天的回收站（懒执行）
export async function purgeExpiredTrash() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  const expired = await prisma.image.findMany({ where: { deletedAt: { lt: cutoff } } });
  const viewer = { id: "system", role: "SUPERADMIN" };
  for (const img of expired) {
    await purgeImage(img.id, viewer).catch(() => {});
  }
}

// ============ 批量操作 ============
// 可见性中文名（日志用）
const VIS_TEXT: Record<string, string> = { PUBLIC: "公开", UNLISTED: "友链", PRIVATE: "私有" };

export async function batchImages(viewer: Viewer, input: z.infer<typeof batchActionSchema>) {
  const { ids, action } = input;
  // 归属校验：仅能操作自己的图片（超级管理员除外）
  const owned = await prisma.image.findMany({
    where: { id: { in: ids }, ...(isSuper(viewer.role) ? {} : { userId: viewer.id }) },
  });
  if (owned.length === 0) throw new AppError("没有可操作的图片", 404);

  switch (action) {
    case "delete": {
      await clearAlbumCovers(owned.map((i) => i.id));
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await logActivity(viewer.id, "image_delete", `把 ${owned.length} 张图片移入回收站`);
      break;
    }
    case "restore": {
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) }, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      await logActivity(viewer.id, "restore", `从回收站恢复了 ${owned.length} 张图片`);
      break;
    }
    case "purge": {
      for (const img of owned) await purgeImage(img.id, viewer);
      await logActivity(viewer.id, "purge", `彻底删除了 ${owned.length} 张图片`);
      break;
    }
    case "visibility": {
      if (!input.visibility) throw new AppError("缺少可见性参数", 400);
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) } },
        data: { visibility: input.visibility },
      });
      await logActivity(viewer.id, "visibility", `把 ${owned.length} 张图片设为${VIS_TEXT[input.visibility] ?? input.visibility}`);
      break;
    }
    case "album": {
      if (input.albumId) {
        const album = await prisma.album.findUnique({ where: { id: input.albumId } });
        if (!album || (album.userId !== viewer.id && !isSuper(viewer.role))) {
          throw new AppError("相册不存在或无权访问", 403);
        }
      }
      // 图片被移出原相册（或移往别的相册）时，清空原相册对它们的封面引用
      await clearAlbumCovers(owned.map((i) => i.id), input.albumId ?? undefined);
      await prisma.image.updateMany({
        where: { id: { in: owned.map((i) => i.id) } },
        data: { albumId: input.albumId ?? null },
      });
      if (input.albumId) {
        const target = await prisma.album.findUnique({ where: { id: input.albumId }, select: { name: true } });
        await logActivity(viewer.id, "album", `把 ${owned.length} 张图片移入相册「${target?.name ?? "未命名"}」`);
      } else {
        await logActivity(viewer.id, "album", `把 ${owned.length} 张图片移出了相册`);
      }
      break;
    }
  }
  // 批量操作统一失效直链缓存（delete/restore/purge/visibility/album 全部改变图片行）
  await invalidateImageView(...owned.map((i) => i.id));
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
  } else if (!isSuper(viewer.role)) {
    // 相册管理页：普通用户与普通管理员只能看到自己的相册，超级管理员可见全部人的
    userId = viewer.id;
  }
  const albums = await prisma.album.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(userId && userId !== viewer.id && !isSuper(viewer.role) ? { visibility: "PUBLIC" } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
      _count: { select: { images: { where: { deletedAt: null, postId: null } } } },
    },
  });
  // 视频没有缩略图，封面若指向视频则回退为占位
  const coverIds = albums.map((a) => a.coverImageId).filter((x): x is string => Boolean(x));
  const coverRows = coverIds.length
    ? await prisma.image.findMany({ where: { id: { in: coverIds } }, select: { id: true, mimeType: true } })
    : [];
  const videoCovers = new Set(coverRows.filter((i) => i.mimeType.startsWith("video/")).map((i) => i.id));
  // 封面默认值：未手动设置封面（或封面指向视频无缩略图）时，默认取相册内第一张图片（最早上传）作为封面
  const coverlessIds = albums
    .filter((a) => (!a.coverImageId || videoCovers.has(a.coverImageId)) && a._count.images > 0)
    .map((a) => a.id);
  // 单次 DISTINCT ON 查询取每个相册最早的非视频图片（替代逐相册 findFirst 的 N+1）
  const firstRows = coverlessIds.length
    ? await prisma.image.findMany({
        where: { albumId: { in: coverlessIds }, deletedAt: null, postId: null, mimeType: { not: { startsWith: "video" } } },
        orderBy: [{ albumId: "asc" }, { createdAt: "asc" }],
        distinct: ["albumId"],
        select: { id: true, albumId: true },
      })
    : [];
  const fallbacks = new Map(firstRows.map((r) => [r.albumId, `/api/images/${r.id}/thumb`] as const));
  return albums.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    slug: a.slug,
    visibility: a.visibility,
    coverImageId: a.coverImageId,
    imageCount: a._count.images,
    createdAt: a.createdAt,
    // 管理员视角附带相册主人，便于区分所有人的相册
    ownerName: isAdminRole(viewer.role) ? a.user.name : undefined,
    coverUrl: a.coverImageId && !videoCovers.has(a.coverImageId) ? `/api/images/${a.coverImageId}/thumb` : fallbacks.get(a.id) ?? null,
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
  if (album.userId !== viewer.id && !isSuper(viewer.role)) throw new AppError("无权操作", 403);
  if (input.coverImageId != null) {
    const img = await prisma.image.findUnique({ where: { id: input.coverImageId } });
    if (!img || img.albumId !== id) throw new AppError("封面图片必须属于该相册", 400);
  }
  return prisma.album.update({ where: { id }, data: input });
}

export async function deleteAlbum(id: string, viewer: Viewer) {
  const album = await prisma.album.findUnique({ where: { id } });
  if (!album) throw new AppError("相册不存在", 404);
  if (album.userId !== viewer.id && !isSuper(viewer.role)) throw new AppError("无权操作", 403);
  await prisma.album.delete({ where: { id } }); // images.albumId SetNull
}

export async function getAlbumForView(idOrSlug: string, viewer: Viewer) {
  const album = await prisma.album.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      user: { select: { name: true } },
      _count: { select: { images: { where: { deletedAt: null, postId: null } } } },
    },
  });
  if (!album) throw new AppError("相册不存在", 404);
  const isOwner = album.userId === viewer.id || isSuper(viewer.role);
  if (!isOwner && album.visibility !== "PUBLIC") throw new AppError("无权访问该相册", 403);
  return { ...album, imageCount: album._count.images };
}
