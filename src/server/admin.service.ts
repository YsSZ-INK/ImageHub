import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getStorageFor } from "@/lib/storage";
import { markerLabel, slotDisplayName } from "@/lib/markers";
import { getSettings } from "@/lib/settings";
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
  // 已用空间 = 本地文件占用（配额口径：R2 中的文件不占配额，见 storage-stats.ts）
  const locals = await prisma.image.groupBy({
    by: ["userId"],
    _sum: { size: true },
    where: { storage: "local", userId: { in: users.map((u) => u.id) } },
  });
  const localMap = new Map(locals.map((g) => [g.userId, g._sum.size ?? 0n]));
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    avatarUrl: u.avatarUrl,
    emailVerified: u.emailVerified,
    storageQuota: u.storageQuota.toString(),
    storageUsed: (localMap.get(u.id) ?? 0n).toString(),
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
  // 按记录的实际存放位置删除（local / r2:<n>）；配额为实时聚合，无需扣减
  const storage = await getStorageFor(img.storage);
  await prisma.image.delete({ where: { id } });
  await Promise.allSettled([storage.delete(img.storageKey), storage.delete(img.thumbKey)]);
}

// 统计面板：核心计数 + 7 天趋势 + 存储分布 + 上传 Top5 + 最近注册
export async function adminStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [
    userCount,
    imageCount,
    storageAgg,
    recentUploads,
    todayCount,
    pendingCount,
    trashCount,
    storageGroups,
    topRows,
    recentUsers,
    settings,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.image.count({ where: { deletedAt: null } }),
    prisma.image.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
    prisma.image.findMany({
      where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } },
      select: { createdAt: true },
    }),
    prisma.image.count({ where: { deletedAt: null, createdAt: { gte: startOfToday } } }),
    prisma.image.count({ where: { status: "PENDING", deletedAt: null } }),
    prisma.image.count({ where: { deletedAt: { not: null } } }),
    // 存储位置分布：各位置图片数与占用（deletedAt: null 口径）
    prisma.image.groupBy({ by: ["storage"], where: { deletedAt: null }, _count: true, _sum: { size: true } }),
    // 上传 Top5 用户（按未删除图片数）
    prisma.image.groupBy({
      by: ["userId"],
      where: { deletedAt: null },
      _count: true,
      _sum: { size: true },
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { name: true, email: true, role: true, createdAt: true },
    }),
    getSettings(),
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

  // Top5 用户补名称
  const topUsers = await prisma.user.findMany({
    where: { id: { in: topRows.map((r) => r.userId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(topUsers.map((u) => [u.id, u.name]));

  // 存储位置标签：现行命名规则；已删除/未配置槽位回退默认名
  const slotIndex = (m: string) => Number(m.slice(3)) || 0;
  return {
    userCount,
    imageCount,
    totalStorage: (storageAgg._sum.size ?? 0).toString(),
    todayCount,
    pendingCount,
    trashCount,
    trend: days,
    storageBreakdown: storageGroups
      .map((g) => {
        const m = g.storage;
        const idx = slotIndex(m);
        const cfg = m.startsWith("r2:") ? settings.r2Slots[idx] : undefined;
        return {
          marker: m,
          label: cfg ? slotDisplayName(cfg, idx, settings.r2Slots.length) : markerLabel(m),
          count: g._count,
          size: (g._sum.size ?? 0).toString(),
        };
      })
      .sort((a, b) => Number(b.size) - Number(a.size)),
    topUploaders: topRows.map((r) => ({
      name: nameMap.get(r.userId) ?? "已注销用户",
      count: r._count,
      size: (r._sum.size ?? 0).toString(),
    })),
    recentUsers: recentUsers.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}
