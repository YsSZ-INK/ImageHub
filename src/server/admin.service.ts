import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getStorageFor } from "@/lib/storage";
import { deleteAccount } from "@/server/user.service";
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

// ============ 删除用户（永久删除该用户全部数据：图片 / 相册 / 动态 / 存储） ============
export async function adminDeleteUser(adminId: string, id: string) {
  if (id === adminId) throw new AppError("不能删除自己的账号，请使用「个人中心 → 账号注销」", 400);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError("用户不存在", 404);
  // 保护：管理员需先降级再删除，避免误删后台管理账号
  if (user.role === "ADMIN") throw new AppError("管理员不能直接删除，请先降级为普通用户", 400);
  await deleteAccount(user);
}

export async function adminUpdateUser(
  adminId: string,
  id: string,
  patch: { status?: string; role?: string; storageQuotaGB?: number }
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError("用户不存在", 404);
  // 保护：不能封禁自己，避免把自己锁在后台外面
  if (patch.status === "BANNED" && id === adminId) throw new AppError("不能封禁自己", 400);
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

// 图片审核队列（全站待审核图片，页码分页）
export async function adminListPendingImages(page = 1, pageSize = 24) {
  const where = { status: "PENDING", deletedAt: null };
  const p = Math.max(1, Math.floor(page) || 1);
  const [total, rows] = await Promise.all([
    prisma.image.count({ where }),
    prisma.image.findMany({
      where,
      orderBy: { createdAt: "asc" }, // 先传先审
      skip: (p - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);
  return {
    items: rows.map((i) => ({
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
    page: p,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
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
  // 按记录的实际存放位置删除（local / r2）
  const storage = await getStorageFor(img.storage);
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
