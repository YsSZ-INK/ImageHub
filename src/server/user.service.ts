import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { mailer } from "@/lib/mailer";
import { getStorage } from "@/lib/storage";
import { processAndStoreAvatar } from "@/lib/image";
import type { User } from "@prisma/client";
import type { z } from "zod";
import type {
  registerSchema,
  profileSchema,
  changePasswordSchema,
  requestResetSchema,
  resetPasswordSchema,
} from "@/lib/validation";

const SITE_URL = () => process.env.SITE_URL ?? "http://localhost:3000";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// ============ 注册 ============
export async function registerUser(input: z.infer<typeof registerSchema>): Promise<User> {
  const email = input.email.toLowerCase();
  const existsEmail = await prisma.user.findUnique({ where: { email } });
  if (existsEmail) throw new AppError("该邮箱已被注册", 409);
  const existsName = await prisma.user.findUnique({ where: { name: input.name } });
  if (existsName) throw new AppError("用户名已被占用", 409);

  const passwordHash = await bcrypt.hash(input.password, 12);
  // 首个注册用户自动成为管理员（生产环境无 seed 时用于引导）
  const role = (await prisma.user.count()) === 0 ? "ADMIN" : "USER";
  const user = await prisma.user.create({
    data: { email, name: input.name, passwordHash, role },
  });
  await sendVerifyEmail(user);
  return user;
}

// ============ 邮箱验证 ============
async function createToken(userId: string, type: "EMAIL_VERIFY" | "PASSWORD_RESET", ttlMs: number) {
  const token = randomBytes(32).toString("hex");
  await prisma.token.deleteMany({ where: { userId, type } });
  await prisma.token.create({
    data: { userId, type, token: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

export async function sendVerifyEmail(user: User) {
  if (user.emailVerified) throw new AppError("邮箱已验证", 400);
  const token = await createToken(user.id, "EMAIL_VERIFY", 24 * 3600_000);
  const link = `${SITE_URL()}/verify-email?token=${token}`;
  await mailer.send(user.email, "ImageHub 邮箱验证", `请在 24 小时内点击链接完成验证：\n${link}`);
}

export async function verifyEmail(token: string) {
  const row = await prisma.token.findUnique({
    where: { token: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.type !== "EMAIL_VERIFY") throw new AppError("链接无效", 400);
  if (row.usedAt) throw new AppError("链接已使用", 400);
  if (row.expiresAt < new Date()) throw new AppError("链接已过期，请重新发送", 400);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } }),
    prisma.token.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
}

// ============ 找回密码 ============
export async function requestPasswordReset(input: z.infer<typeof requestResetSchema>) {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  // 无论是否存在都静默成功，避免邮箱枚举
  if (!user) return;
  const token = await createToken(user.id, "PASSWORD_RESET", 3600_000);
  const link = `${SITE_URL()}/reset-password?token=${token}`;
  await mailer.send(user.email, "ImageHub 重置密码", `请在 1 小时内点击链接重置密码：\n${link}`);
}

export async function resetPassword(input: z.infer<typeof resetPasswordSchema>) {
  const row = await prisma.token.findUnique({
    where: { token: hashToken(input.token) },
    include: { user: true },
  });
  if (!row || row.type !== "PASSWORD_RESET") throw new AppError("链接无效", 400);
  if (row.usedAt) throw new AppError("链接已使用", 400);
  if (row.expiresAt < new Date()) throw new AppError("链接已过期", 400);
  const passwordHash = await bcrypt.hash(input.password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.token.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
}

// ============ 个人中心 ============
export async function updateProfile(user: User, input: z.infer<typeof profileSchema>): Promise<User> {
  if (input.name && input.name !== user.name) {
    const exists = await prisma.user.findUnique({ where: { name: input.name } });
    if (exists) throw new AppError("用户名已被占用", 409);
  }
  return prisma.user.update({
    where: { id: user.id },
    data: { name: input.name, avatarUrl: input.avatarUrl },
  });
}

export async function changePassword(user: User, input: z.infer<typeof changePasswordSchema>) {
  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) throw new AppError("当前密码不正确", 400);
  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
}

export async function updateAvatar(user: User, buf: Buffer): Promise<User> {
  const key = await processAndStoreAvatar(buf, user.id);
  const avatarUrl = `/api/avatars/${user.id}?v=${Date.now()}`;
  return prisma.user.update({ where: { id: user.id }, data: { avatarUrl } });
}

export async function getAvatar(userId: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.avatarUrl) return null;
  try {
    const buf = await (await getStorage()).get(`avatars/${userId}.webp`);
    return { buf, contentType: "image/webp" };
  } catch {
    return null;
  }
}

// ============ 账号注销：级联删除图片、相册与存储对象 ============
export async function deleteAccount(user: User) {
  const images = await prisma.image.findMany({ where: { userId: user.id } });
  const storage = await getStorage();
  const keys = images.flatMap((i) => [i.storageKey, i.thumbKey]);
  await prisma.user.delete({ where: { id: user.id } }); // 级联删除 Image/Album/Tag/Token
  // 存储删除放事务外，尽力而为
  await Promise.allSettled(keys.map((k) => storage.delete(k)));
  await storage.delete(`avatars/${user.id}.webp`).catch(() => {});
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerified,
    storageQuota: u.storageQuota.toString(),
    storageUsed: u.storageUsed.toString(),
    createdAt: u.createdAt,
  };
}
