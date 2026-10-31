import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { toDTO, makeSlug, type Viewer } from "@/server/image.service";
import type { ImageDTO } from "@/server/image.service";
import type { User } from "@prisma/client";

export const DEFAULT_ALBUM_NAME = "日常记录";

export type PostDTO = {
  id: string;
  caption: string;
  createdAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
  images: ImageDTO[];
};

// ============ 默认相册（懒创建：发布动态时图片归入「日常记录」） ============
export async function ensureDefaultAlbum(userId: string) {
  const existing = await prisma.album.findFirst({
    where: { userId, name: DEFAULT_ALBUM_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.album.create({
    data: {
      userId,
      name: DEFAULT_ALBUM_NAME,
      slug: makeSlug(DEFAULT_ALBUM_NAME),
      visibility: "PUBLIC",
      description: "图文动态发布的照片默认存放于此",
    },
  });
}

// ============ 动态列表（朋友圈式 feed，游标分页，支持时间范围过滤） ============
// 仅展示至少含一张公开图片的动态；动态内图片同样只取未删除且公开的（发布后图片被改私有/删除时自动从 feed 消失）
export async function listPosts(
  viewer: Viewer,
  cursor?: string,
  take = 10,
  range?: { from?: Date; to?: Date }
) {
  const rows = await prisma.post.findMany({
    where: {
      images: { some: { deletedAt: null, visibility: "PUBLIC", status: "PUBLISHED" } },
      ...(range?.from || range?.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    // 追加 id 决胜：createdAt 并列时游标翻页才稳定（避免同一动态跨页重复）
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      images: {
        where: { deletedAt: null, visibility: "PUBLIC" },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
    },
  });

  const hasMore = rows.length > take;
  const items: (PostDTO & { canDelete: boolean })[] = rows.slice(0, take).map((p) => ({
    id: p.id,
    caption: p.caption,
    createdAt: p.createdAt,
    author: { id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl },
    images: p.images.map(toDTO),
    canDelete: p.user.id === viewer.id || viewer.role === "ADMIN",
  }));
  return { items, nextCursor: hasMore ? rows[take - 1].id : null };
}

// ============ 发布动态 ============
export async function createPost(
  user: User,
  input: { caption: string; imageIds: string[] }
): Promise<PostDTO> {
  // 归属校验：图片必须属于本人且未删除
  const images = await prisma.image.findMany({
    where: { id: { in: input.imageIds }, userId: user.id, deletedAt: null },
  });
  if (images.length !== input.imageIds.length) {
    throw new AppError("包含不存在或不可用的图片", 400);
  }

  // 无默认相册则懒创建，图片归入「日常记录」（已在其他相册的图片保持原归属）
  const defaultAlbum = await ensureDefaultAlbum(user.id);

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: { userId: user.id, caption: input.caption },
    });
    for (const img of images) {
      await tx.image.update({
        where: { id: img.id },
        data: {
          visibility: "PUBLIC", // 进 feed 的图片必须公开
          postId: created.id,
          albumId: img.albumId ?? defaultAlbum.id,
        },
      });
    }
    return created;
  });

  const full = await prisma.post.findUnique({
    where: { id: post.id },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      images: {
        where: { deletedAt: null, visibility: "PUBLIC" },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!full) throw new AppError("动态创建失败", 500);
  return {
    id: full.id,
    caption: full.caption,
    createdAt: full.createdAt,
    author: { id: full.user.id, name: full.user.name, avatarUrl: full.user.avatarUrl },
    images: full.images.map(toDTO),
  };
}

// ============ 删除动态（仅删 Post，图片留在相册） ============
export async function deletePost(postId: string, viewer: Viewer) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new AppError("动态不存在", 404);
  if (post.userId !== viewer.id && viewer.role !== "ADMIN") throw new AppError("无权操作该动态", 403);
  // images.postId 为 SetNull：图片记录与相册归属保留
  await prisma.post.delete({ where: { id: postId } });
}
