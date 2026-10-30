import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import type { z } from "zod";
import type { adminUserCreateSchema } from "@/lib/validation";

// ============ 管理后台 ============

export async function adminListUsers(search?: string) {
  const users = await prisma.user.findMany({
    where: search
      ? { OR: [{ email: { contains: search } }, { name: { contains: search } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { images: { where: { deletedAt: null } } } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    avatarUrl: u.avatarUrl,
    emailVerified: u.emailVerified,
    storageQuota: u.storageQuota.toString(),
    storageUsed: u.storageUsed.toString(),
    imageCount: u._count.images,
    createdAt: u.createdAt,
  }));
}

// 管理员创建用户（邮箱/用户名查重 + 强密码哈希，角色与配额由管理员指定）
export async function adminCreateUser(input: z.infer<typeof adminUserCreateSchema>) {
  const email = input.email.toLowerCase();
  const existsEmail = await prisma.user.findUnique({ where: { email } });
  if (existsEmail) throw new AppError("该邮箱已被注册", 409);
  const existsName = await prisma.user.findUnique({ where: { name: input.name } });
  if (existsName) throw new AppError("用户名已被占用", 409);
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: {
      email,
      name: input.name,
      passwordHash,
      role: input.role,
      ...(input.storageQuotaGB !== undefined
        ? { storageQuota: BigInt(Math.round(input.storageQuotaGB * 1024 ** 3)) }
        : {}),
    },
  });
}

export async function adminUpdateUser(
  id: string,
  patch: { status?: string; role?: string; storageQuotaGB?: number }
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError("用户不存在", 404);
  // 保护：最后一个管理员不能降级，避免后台失去管理能力
  if (patch.role === "USER" && user.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) throw new AppError("不能降级最后一个管理员", 400);
  }
  return prisma.user.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.storageQuotaGB !== undefined
        ? { storageQuota: BigInt(Math.round(patch.storageQuotaGB * 1024 ** 3)) }
        : {}),
    },
  });
}

// 图片审核列表（全站）
export async function adminListImages(cursor?: string, take = 24) {
  const rows = await prisma.image.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { name: true, email: true } } },
  });
  const hasMore = rows.length > take;
  return {
    items: rows.slice(0, take).map((i) => ({
      id: i.id,
      filename: i.filename,
      visibility: i.visibility,
      size: i.size,
      mimeType: i.mimeType,
      createdAt: i.createdAt,
      thumbUrl: `/api/images/${i.id}/thumb`,
      ownerName: i.user.name,
      ownerEmail: i.user.email,
    })),
    nextCursor: hasMore ? rows[take - 1].id : null,
  };
}

// 下架：改为 PRIVATE（仍属用户自己可见，但不进画廊）
export async function adminTakedownImage(id: string) {
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw new AppError("图片不存在", 404);
  return prisma.image.update({ where: { id }, data: { visibility: "PRIVATE" } });
}

export async function adminPurgeImage(id: string) {
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw new AppError("图片不存在", 404);
  const storage = await getStorage();
  await prisma.image.delete({ where: { id } });
  await Promise.allSettled([storage.delete(img.storageKey), storage.delete(img.thumbKey)]);
  await prisma.user
    .update({ where: { id: img.userId }, data: { storageUsed: { decrement: BigInt(img.size) } } })
    .catch(() => {});
}

// 统计面板
export async function adminStats() {
  const [userCount, imageCount, storageAgg, recentUploads] = await Promise.all([
    prisma.user.count(),
    prisma.image.count({ where: { deletedAt: null } }),
    prisma.image.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
    prisma.image.findMany({
      where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } },
      select: { createdAt: true },
    }),
  ]);

  // 近 7 天上传趋势
  const days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    days.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      count: recentUploads.filter((r) => r.createdAt >= d && r.createdAt < next).length,
    });
  }

  return {
    userCount,
    imageCount,
    totalStorage: (storageAgg._sum.size ?? 0).toString(),
    trend: days,
  };
}
