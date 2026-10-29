import { prisma } from "@/lib/db";

export type SiteSettings = {
  siteName: string;
  allowRegister: boolean;
  maxUploadMB: number;
  // 邮件（SMTP）配置：host 为空表示未配置；端口 0 表示未设置
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
};

const DEFAULTS: SiteSettings = {
  siteName: "ImageHub",
  allowRegister: true,
  maxUploadMB: 50,
  smtpHost: "",
  smtpPort: 0,
  smtpSecure: true,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
};

let cache: { value: SiteSettings; expiresAt: number } | null = null;

// 站点设置：读取带 60s 缓存；写入后清缓存
export async function getSettings(): Promise<SiteSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  try {
    const rows = await prisma.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const value: SiteSettings = {
      siteName: map.get("siteName") ?? DEFAULTS.siteName,
      allowRegister: (map.get("allowRegister") ?? "true") === "true",
      maxUploadMB: Number(map.get("maxUploadMB") ?? DEFAULTS.maxUploadMB),
      smtpHost: map.get("smtpHost") ?? "",
      smtpPort: Number(map.get("smtpPort") ?? 0),
      smtpSecure: (map.get("smtpSecure") ?? "true") === "true",
      smtpUser: map.get("smtpUser") ?? "",
      smtpPass: map.get("smtpPass") ?? "",
      smtpFrom: map.get("smtpFrom") ?? "",
    };
    cache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  } catch {
    // 数据库尚未初始化时返回默认值
    return DEFAULTS;
  }
}

export async function saveSettings(patch: Partial<SiteSettings>) {
  const entries = Object.entries(patch).map(([k, v]) => ({ key: k, value: String(v) }));
  for (const { key, value } of entries) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  cache = null;
}

// 上传大小上限：站点设置优先，环境变量兜底
export function envMaxUploadMB(): number {
  return Number(process.env.MAX_UPLOAD_MB ?? 50);
}
