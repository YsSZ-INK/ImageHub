// 存储槽位类型与显示名工具（客户端安全：不依赖任何服务端模块）
// 槽位标记格式：local | r2:<下标>；r2 / r2b 为早期版本遗留标记

export type SlotType = "r2" | "oss" | "cos" | "s3";

// 可添加的存储类型：添加存储时选择，按类型渲染对应表单
export const SLOT_TYPES: { type: SlotType; name: string; hint: string }[] = [
  { type: "r2", name: "Cloudflare R2", hint: "Account ID + API 令牌" },
  { type: "oss", name: "阿里云 OSS", hint: "Region + AccessKey" },
  { type: "cos", name: "腾讯云 COS", hint: "Region + 密钥" },
  { type: "s3", name: "S3 兼容（MinIO / 百度 BOS 等）", hint: "自定义端点 + Region" },
];

export function slotBaseName(type?: string): string {
  switch (type) {
    case "oss": return "OSS";
    case "cos": return "COS";
    case "s3": return "S3";
    default: return "R2";
  }
}

// 端点推导：显式 endpoint > 按类型+Region 推导（OSS/COS）> R2 Account ID 端点
export function slotEndpoint(cfg: {
  type?: string;
  accountId?: string;
  endpoint?: string;
  region?: string;
}): string {
  const ep = cfg.endpoint?.trim();
  if (ep) return ep;
  const region = cfg.region?.trim();
  if (cfg.type === "oss" && region) return `https://oss-${region}.aliyuncs.com`;
  if (cfg.type === "cos" && region) return `https://cos.${region}.myqcloud.com`;
  if ((!cfg.type || cfg.type === "r2") && cfg.accountId?.trim()) {
    return `https://${cfg.accountId.trim()}.r2.cloudflarestorage.com`;
  }
  return "";
}

// 槽位是否配置完整（不含 Secret 是否已存/已填的判断，调用方自行叠加）
export function slotConfigured(cfg: {
  type?: string;
  accountId?: string;
  accessKeyId?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
}): boolean {
  if (!cfg.accessKeyId?.trim() || !cfg.bucket?.trim()) return false;
  // R2 需要 Account ID；OSS/COS 需要 Region（端点自动推导）；S3 兼容需要手填端点
  if (cfg.type === "oss" || cfg.type === "cos") return !!cfg.region?.trim();
  if (cfg.type === "s3") return !!slotEndpoint(cfg);
  return !!cfg.accountId?.trim();
}

// 槽位显示名：自定义 label 优先；单槽直接用类型名（R2 / OSS…），多槽带序号（R2-1 / OSS-2…）
export function slotDisplayName(
  cfg: { type?: string; label?: string } | null | undefined,
  index: number,
  total: number
): string {
  const base = cfg?.label?.trim() || slotBaseName(cfg?.type);
  return total > 1 ? `${base}-${index + 1}` : base;
}

export function markerLabel(marker: string): string {
  if (marker === "local") return "本地磁盘";
  return "R2";
}

// 徽标配色：本地蓝、桶橙，用于迁移页/我的照片区分照片所在位置
export function markerBadgeClass(marker: string): string {
  return marker === "local"
    ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
    : "bg-orange-500/15 text-orange-600 dark:text-orange-400";
}
