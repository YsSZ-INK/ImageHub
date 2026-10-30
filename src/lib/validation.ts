import { z } from "zod";

// 密码强度：至少 8 位，含大小写字母与数字
const strongPassword = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码最长 72 位")
  .regex(/[a-z]/, "密码需包含小写字母")
  .regex(/[A-Z]/, "密码需包含大写字母")
  .regex(/[0-9]/, "密码需包含数字");

export const registerSchema = z.object({
  email: z.string().email("邮箱格式不正确").max(100),
  name: z
    .string()
    .min(2, "用户名至少 2 个字符")
    .max(20, "用户名最长 20 个字符")
    .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, "用户名仅限中英文、数字、下划线和连字符"),
  password: strongPassword,
});

export const loginSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(1, "请输入密码"),
  remember: z.boolean().optional(),
});

export const profileSchema = z.object({
  name: registerSchema.shape.name.optional(),
  avatarUrl: z.string().max(300).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: strongPassword,
});

export const visibilityValues = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;

export const imageUpdateSchema = z.object({
  filename: z.string().min(1).max(200).optional(),
  visibility: z.enum(visibilityValues).optional(),
  albumId: z.string().nullable().optional(),
});

export const batchActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "请先选择图片").max(200),
  action: z.enum(["delete", "restore", "purge", "visibility", "album"]),
  visibility: z.enum(visibilityValues).optional(),
  albumId: z.string().nullable().optional(),
});

export const albumCreateSchema = z.object({
  name: z.string().min(1, "相册名不能为空").max(50),
  description: z.string().max(500).optional(),
  visibility: z.enum(visibilityValues).default("PUBLIC"),
});

export const albumUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).nullable().optional(),
  visibility: z.enum(visibilityValues).optional(),
  coverImageId: z.string().nullable().optional(),
});

// 图文动态：文字 + 1~9 张图（朋友圈式九宫格）
export const postCreateSchema = z.object({
  caption: z.string().max(1000, "文字最长 1000 字").default(""),
  imageIds: z.array(z.string().min(1)).min(1, "至少选择一张图片").max(9, "最多 9 张图片"),
});

export const adminUserUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "BANNED"]).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  storageQuotaGB: z.number().min(0.1).max(1024 * 10).optional(),
});

// 管理员创建用户：复用注册的邮箱/用户名/密码强度校验
export const adminUserCreateSchema = registerSchema.extend({
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  storageQuotaGB: z.number().min(0.1).max(1024 * 10).optional(),
});

export const adminSettingsSchema = z.object({
  siteName: z.string().min(1).max(50),
  allowRegister: z.boolean(),
  maxUploadMB: z.number().min(1).max(512),
  // 存储驱动：local 本地磁盘 | r2 Cloudflare R2（写入桶由 r2UploadSlot 指定）
  storageDriver: z.enum(["local", "r2"]),
  r2Slots: z
    .array(
      z.object({
        accountId: z.string().max(64).trim(),
        accessKeyId: z.string().max(128).trim(),
        secretAccessKey: z.string().max(128),
        bucket: z.string().max(128).trim(),
      })
    )
    .max(8),
  r2UploadSlot: z.number().int().min(0).max(7),
  // 邮件（SMTP）配置：host 为空表示未配置；端口 0 表示未设置
  smtpHost: z.string().max(255).trim(),
  smtpPort: z.number().int().min(0).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().max(255).trim(),
  smtpPass: z.string().max(255),
  smtpFrom: z.string().max(255).trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: strongPassword,
});

export const requestResetSchema = z.object({
  email: z.string().email(),
});
