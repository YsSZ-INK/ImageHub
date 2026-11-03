import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isAdminRole } from "@/lib/roles";
import { logActivity } from "@/server/audit.service";
import { toDTO, clearAlbumCovers, invalidateImageView, type Viewer } from "@/server/image.service";
import type { ImageDTO } from "@/server/image.service";
import type { User, Image } from "@prisma/client";

export type PostDTO = {
  id: string;
  caption: string;
  createdAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
  images: ImageDTO[];
};

// ============ 动态列表（朋友圈式 feed，游标分页，支持时间范围过滤） ============
// 纯文字动态直接展示；带图动态至少要有一张公开已过审的图片（发布后图片被改私有/删除时自动从 feed 消失）
export async function listPosts(
  viewer: Viewer,
  cursor?: string,
  take = 10,
  range?: { from?: Date; to?: Date }
) {
  const rows = await prisma.post.findMany({
    where: {
      OR: [
        { images: { none: {} } },
        { images: { some: { deletedAt: null, visibility: "PUBLIC", status: "PUBLISHED" } } },
      ],
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
      _count: { select: { comments: true } },
      images: {
        where: { deletedAt: null, visibility: "PUBLIC" },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
    },
  });

  const hasMore = rows.length > take;
  const items: (PostDTO & { canDelete: boolean; commentCount: number })[] = rows.slice(0, take).map((p) => ({
    id: p.id,
    caption: p.caption,
    createdAt: p.createdAt,
    author: { id: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl },
    images: p.images.map(toDTO),
    canDelete: p.user.id === viewer.id || isAdminRole(viewer.role),
    commentCount: p._count.comments,
  }));
  return { items, nextCursor: hasMore ? rows[take - 1].id : null };
}

// ============ 发布动态 ============
// 支持纯文字动态；带图时图片必须属于本人且未删除。
// 图片随发布立即公开（visibility PUBLIC + status PUBLISHED），无需审核即可在 feed 中展示；
// 照片随发布移出原相册，统一归入「日常记录」（/albums/daily）——动态照片不与「我的相册」等普通相册重复出现。
export async function createPost(
  user: User,
  input: { caption: string; imageIds?: string[] }
): Promise<PostDTO> {
  const ids = input.imageIds ?? [];
  const caption = (input.caption ?? "").trim();
  if (ids.length === 0 && !caption) throw new AppError("写点文字或选择图片再发布", 400);

  // 归属校验：图片必须属于本人且未删除
  let images: Image[] = [];
  if (ids.length > 0) {
    images = await prisma.image.findMany({
      where: { id: { in: ids }, userId: user.id, deletedAt: null },
    });
    if (images.length !== ids.length) {
      throw new AppError("包含不存在或不可用的图片", 400);
    }
  }

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: { userId: user.id, caption },
    });
    for (const img of images) {
      await tx.image.update({
        where: { id: img.id },
        data: {
          visibility: "PUBLIC", // 进 feed 的图片必须公开
          status: "PUBLISHED", // 发动态免审核：随发布立即公开可见
          postId: created.id,
          albumId: null, // 移出原相册：动态照片统一归「日常记录」
        },
      });
    }
    return created;
  });

  await logActivity(user.id, "post", ids.length > 0 ? "发布了图文动态" : "发布了文字动态");
  if (images.length > 0) {
    // 图片移出相册后清空引用它们的相册封面（事务外执行，避免 SQLite 写锁），再失效直链缓存
    await clearAlbumCovers(images.map((i) => i.id));
    await invalidateImageView(...images.map((i) => i.id));
  }

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

// ============ 删除动态 ============
// 带图动态：图片随动态一并移入回收站（软删除，可从回收站恢复）；纯文字动态仅删除本身
export async function deletePost(postId: string, viewer: Viewer) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { user: { select: { name: true } } },
  });
  if (!post) throw new AppError("动态不存在", 404);
  if (post.userId !== viewer.id && !isAdminRole(viewer.role)) throw new AppError("无权操作该动态", 403);
  // images.postId 为 SetNull：先找出本动态的图片再删除动态
  const imgs = await prisma.image.findMany({
    where: { postId, deletedAt: null },
    select: { id: true },
  });
  // 事务内只用 tx 连接（clearAlbumCovers/logActivity 用独立连接，放事务外，避免 SQLite 写锁死锁）
  await prisma.$transaction(async (tx) => {
    await tx.post.delete({ where: { id: postId } });
    if (imgs.length > 0) {
      await tx.image.updateMany({
        where: { id: { in: imgs.map((i) => i.id) } },
        data: { deletedAt: new Date() },
      });
    }
  });
  // 图片进回收站后，清空引用它们的相册封面 + 失效直链缓存
  if (imgs.length > 0) {
    await clearAlbumCovers(imgs.map((i) => i.id));
    await invalidateImageView(...imgs.map((i) => i.id));
  }
  await logActivity(
    viewer.id,
    "post_delete",
    `${post.userId === viewer.id ? "删除了自己的动态" : `删除了 ${post.user.name} 的动态`}${imgs.length > 0 ? `（${imgs.length} 张图片移入回收站）` : ""}`
  );
}

// ============ 动态评论（支持回复） ============
export type CommentDTO = {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string; avatarUrl: string | null };
  canDelete: boolean;
  // 回复：parentId 指向所属顶层评论；replyTo 为被回复人（展示「回复 @某人」）
  parentId: string | null;
  replyTo: { id: string; name: string } | null;
};

const COMMENT_MAX = 500;

// 评论列表（时间正序，含回复；前端按 parentId 分组成线程），canDelete 预计算：本人或管理员可删
export async function listComments(postId: string, viewer: Viewer): Promise<CommentDTO[]> {
  const rows = await prisma.postComment.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      replyToUser: { select: { id: true, name: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
    user: { id: c.user.id, name: c.user.name, avatarUrl: c.user.avatarUrl },
    canDelete: c.userId === viewer.id || isAdminRole(viewer.role),
    parentId: c.parentId,
    replyTo: c.replyToUser ? { id: c.replyToUser.id, name: c.replyToUser.name } : null,
  }));
}

// 发表评论 / 回复：登录用户可评论任意动态（feed 本身登录可见）
// parentId 传被回复评论的 id：若回复的是「回复」，自动归并到同一顶层（一层线程），并记录被回复人
export async function addComment(
  postId: string,
  viewer: Viewer,
  content: string,
  parentId?: string
): Promise<CommentDTO> {
  const text = content.trim();
  if (!text) throw new AppError("评论内容不能为空", 400);
  if (text.length > COMMENT_MAX) throw new AppError(`评论最长 ${COMMENT_MAX} 字`, 400);
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, user: { select: { id: true, name: true } } },
  });
  if (!post) throw new AppError("动态不存在", 404);

  // 回复目标校验：必须属于本动态；归并到顶层（一层线程结构）
  let rootId: string | undefined;
  let replyToUserId: string | undefined;
  if (parentId) {
    const parent = await prisma.postComment.findUnique({ where: { id: parentId } });
    if (!parent || parent.postId !== postId) throw new AppError("被回复的评论不存在", 400);
    rootId = parent.parentId ?? parent.id;
    replyToUserId = parent.userId;
  }

  const created = await prisma.postComment.create({
    data: { postId, userId: viewer.id, content: text, parentId: rootId, replyToUserId },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      replyToUser: { select: { id: true, name: true } },
    },
  });
  await logActivity(
    viewer.id,
    "comment",
    `${replyToUserId ? "回复了" : "评论了"} ${post.user.id === viewer.id ? "自己的动态" : `${post.user.name} 的动态`}`
  );
  return {
    id: created.id,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
    user: { id: created.user.id, name: created.user.name, avatarUrl: created.user.avatarUrl },
    canDelete: true,
    parentId: created.parentId,
    replyTo: created.replyToUser ? { id: created.replyToUser.id, name: created.replyToUser.name } : null,
  };
}

// 删除评论：仅本人或管理员；删除顶层评论时其下回复随级联删除（数据库 onDelete: Cascade）
export async function deleteComment(commentId: string, viewer: Viewer) {
  const c = await prisma.postComment.findUnique({ where: { id: commentId }, include: { user: { select: { name: true } } } });
  if (!c) throw new AppError("评论不存在", 404);
  if (c.userId !== viewer.id && !isAdminRole(viewer.role)) throw new AppError("只能删除自己的评论", 403);
  await prisma.postComment.delete({ where: { id: commentId } });
  await logActivity(viewer.id, "comment_delete", c.userId === viewer.id ? "删除了自己的评论" : `删除了 ${c.user.name} 的评论`);
}
