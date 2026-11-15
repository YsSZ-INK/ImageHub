import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import type { SlotType } from "@/lib/markers";

// 单个 S3 兼容存储桶连接配置（槽位列表存于 settings.r2Slots，JSON 数组）
// type 决定表单与端点推导：r2（Account ID）/ oss（Region 推导）/ cos（Region 推导）/ s3（自定义端点）
// hasSecret 为只读标记：服务端已存有 Secret（Secret 本体永不下发浏览器）
export type R2SlotConfig = {
  type?: SlotType;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  // S3 兼容（MinIO 等）手填端点；OSS/COS 留空按 Region 推导；R2 留空按 Account ID 推导
  endpoint?: string;
  region?: string;
  // 槽位显示名（如「备份桶」），留空按类型与数量自动命名
  label?: string;
  hasSecret?: boolean;
};

// 单个 Redis 地址槽位（槽位列表存于 settings.redisSlots，JSON 数组）
// id 用于「留空保存=保持原地址」按稳定标识回填，避免增删排序后地址串位
export type RedisSlotConfig = {
  id?: string;
  url: string;
  label?: string;
  // 只读标记：服务端已存地址（地址本体永不下发浏览器）
  hasUrl?: boolean;
};

export type SiteSettings = {
  siteName: string;
  allowRegister: boolean;
  maxUploadMB: number;
  // 存储驱动：local 本地磁盘 | r2 Cloudflare R2（具体写入哪个桶由 r2UploadSlot 指定）
  storageDriver: "local" | "r2";
  // R2 存储桶槽位列表（可添加多个）；r2UploadSlot 为新上传写入的桶下标
  r2Slots: R2SlotConfig[];
  r2UploadSlot: number;
  // 邮件（SMTP）配置：host 为空表示未配置；端口 0 表示未设置
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  // 只读标记：服务端已存有 SMTP 授权码（本体永不下发浏览器）
  hasSmtpPass?: boolean;
  smtpFrom: string;
  // Redis 地址槽位（可多个）：主备切换按顺序取第一个可用；同时读写按 key 哈希分担
  redisSlots: RedisSlotConfig[];
  // 多地址工作模式：failover 主备切换 | balance 同时读写
  redisMode: "failover" | "balance";
  // Redis 连接地址（旧单地址字段，保留作为首槽镜像以兼容旧代码）
  // 留空回退环境变量 REDIS_URL，再无则降级进程内存
  redisUrl: string;
  // Redis 启用开关：false 时不连 Redis（限流走进程内存），随时切换、无需重启
  redisEnabled: boolean;
  // 只读标记：服务端已存有 Redis 地址（本体永不下发浏览器）
  hasRedisUrl?: boolean;
  // 对象存储公开访问域名（可选）：配置后匿名访问 PUBLIC 图片原图时 302 到该域名，
  // 图片字节不再经本站中转；留空保持全部经本站代理
  r2PublicBase: string;
};

const EMPTY_SLOT: R2SlotConfig = { accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "" };

const DEFAULTS: SiteSettings = {
  siteName: "ImageHub",
  allowRegister: true,
  maxUploadMB: 50,
  storageDriver: "local",
  r2Slots: [],
  r2UploadSlot: 0,
  smtpHost: "",
  smtpPort: 0,
  smtpSecure: true,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  redisSlots: [],
  redisMode: "failover",
  redisUrl: "",
  redisEnabled: false,
  r2PublicBase: "",
};

let cache: { value: SiteSettings; expiresAt: number } | null = null;

// 从 JSON 数组解析槽位列表，容忍脏数据
function parseR2Slots(raw: string | undefined): R2SlotConfig[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((v) => ({
      type: v?.type === "oss" || v?.type === "cos" || v?.type === "s3" || v?.type === "r2" ? v.type : undefined,
      accountId: typeof v?.accountId === "string" ? v.accountId : "",
      accessKeyId: typeof v?.accessKeyId === "string" ? v.accessKeyId : "",
      secretAccessKey: typeof v?.secretAccessKey === "string" ? v.secretAccessKey : "",
      bucket: typeof v?.bucket === "string" ? v.bucket : "",
      endpoint: typeof v?.endpoint === "string" ? v.endpoint : "",
      region: typeof v?.region === "string" ? v.region : "",
      label: typeof v?.label === "string" ? v.label : "",
    }));
  } catch {
    return null;
  }
}

// 从 JSON 数组解析 Redis 槽位：url 落库时加密，读取时解密；缺失 id 用 s{i} 补齐
function parseRedisSlots(raw: string | undefined): RedisSlotConfig[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr
      .map((v, i) => ({
        id: typeof v?.id === "string" && v.id ? v.id : `s${i}`,
        url: decryptSecret(typeof v?.url === "string" ? v.url : ""),
        label: typeof v?.label === "string" ? v.label : "",
      }))
      .filter((s) => s.url);
  } catch {
    return null;
  }
}

// 站点设置：读取带 60s 缓存；写入后清缓存
export async function getSettings(): Promise<SiteSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  try {
    const rows = await prisma.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    // 槽位列表优先读 r2Slots；缺失时从旧版单槽字段合成（含 r2b 过渡版），保证老数据平滑升级
    const r2Slots =
      parseR2Slots(map.get("r2Slots")) ??
      [
        {
          accountId: map.get("r2AccountId") ?? "",
          accessKeyId: map.get("r2AccessKeyId") ?? "",
          secretAccessKey: map.get("r2SecretAccessKey") ?? "",
          bucket: map.get("r2Bucket") ?? "",
        },
        {
          accountId: map.get("r2bAccountId") ?? "",
          accessKeyId: map.get("r2bAccessKeyId") ?? "",
          secretAccessKey: map.get("r2bSecretAccessKey") ?? "",
          bucket: map.get("r2bBucket") ?? "",
        },
      ].filter((s) => s.accountId || s.bucket);
    const legacyRedisUrl = decryptSecret(map.get("redisUrl"));
    // 槽位列表优先；老实例只有单地址字段时自动合成为单槽位（不要求手工迁移）
    const redisSlots = parseRedisSlots(map.get("redisSlots")) ?? (legacyRedisUrl ? [{ id: "legacy", url: legacyRedisUrl }] : []);
    const value: SiteSettings = {
      siteName: map.get("siteName") ?? DEFAULTS.siteName,
      allowRegister: (map.get("allowRegister") ?? "true") === "true",
      maxUploadMB: Number(map.get("maxUploadMB") ?? DEFAULTS.maxUploadMB),
      storageDriver: map.get("storageDriver") === "r2" ? "r2" : "local",
      r2Slots,
      r2UploadSlot: Math.min(Math.max(Number(map.get("r2UploadSlot") ?? 0) || 0, 0), Math.max(r2Slots.length - 1, 0)),
      smtpHost: map.get("smtpHost") ?? "",
      smtpPort: Number(map.get("smtpPort") ?? 0),
      smtpSecure: (map.get("smtpSecure") ?? "true") === "true",
      smtpUser: map.get("smtpUser") ?? "",
      smtpPass: map.get("smtpPass") ?? "",
      smtpFrom: map.get("smtpFrom") ?? "",
      redisSlots,
      redisMode: map.get("redisMode") === "balance" ? "balance" : "failover",
      redisUrl: redisSlots[0]?.url ?? "",
      redisEnabled: map.get("redisEnabled") === "true",
      r2PublicBase: (map.get("r2PublicBase") ?? "").trim().replace(/\/+$/, ""),
    };
    cache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  } catch {
    // 数据库尚未初始化时返回默认值
    return DEFAULTS;
  }
}

export async function saveSettings(patch: Partial<SiteSettings>) {
  // 剥离客户端只读标记（hasSecret / hasSmtpPass / hasRedisUrl），密钥本体在调用方（路由层）合并后传入
  // redisSlots 单独序列化（对象数组直接 String() 会变成 [object Object]）
  const { r2Slots, redisSlots, ...rest } = patch;
  const entries = Object.entries(rest)
    .filter(([k]) => k !== "hasSmtpPass" && k !== "hasRedisUrl")
    .map(([k, v]) => ({ key: k, value: String(v) }));
  // Redis 地址落库前加密（enc:v1:... 前缀标记，getSettings 读取时自动解密）
  for (const e of entries) {
    if (e.key === "redisUrl" && e.value && !e.value.startsWith("enc:v1:")) {
      e.value = encryptSecret(e.value);
    }
  }
  if (redisSlots) {
    const slots = redisSlots
      .map((s) => ({
        // 稳定 id：调用方不传时新生成，保证后续「留空保存」能按 id 回填
        id: s.id || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        url: (s.url ?? "").trim(),
        label: (s.label ?? "").trim(),
      }))
      .filter((s) => s.url)
      .map((s) => ({ ...s, url: s.url.startsWith("enc:v1:") ? s.url : encryptSecret(s.url) }));
    entries.push({ key: "redisSlots", value: JSON.stringify(slots) });
    // 首槽写回旧单地址字段，保持向下兼容（旧版本代码仍能读到第一个地址）
    entries.push({ key: "redisUrl", value: slots[0]?.url ?? "" });
  }
  if (r2Slots) {
    const slots = r2Slots.map(({ hasSecret: _omit, ...slot }) => slot);
    entries.push({ key: "r2Slots", value: JSON.stringify(slots) });
    // 首槽同步进旧版单槽字段，保持向下兼容（旧版本代码仍能读到 R2 一的配置）
    const s0 = slots[0] ?? EMPTY_SLOT;
    entries.push(
      { key: "r2AccountId", value: s0.accountId },
      { key: "r2AccessKeyId", value: s0.accessKeyId },
      { key: "r2SecretAccessKey", value: s0.secretAccessKey },
      { key: "r2Bucket", value: s0.bucket }
    );
  }
  for (const { key, value } of entries) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  cache = null;
}

// 脱敏：密钥类字段永不下发浏览器（置空 + has* 标记表示「服务端已存有，留空提交即保持不变」）
export function sanitizeSettings(s: SiteSettings): SiteSettings {
  return {
    ...s,
    r2Slots: s.r2Slots.map((r) => ({
      type: r.type,
      accountId: r.accountId,
      accessKeyId: r.accessKeyId,
      secretAccessKey: "",
      bucket: r.bucket,
      endpoint: r.endpoint ?? "",
      region: r.region ?? "",
      label: r.label ?? "",
      hasSecret: !!r.secretAccessKey,
    })),
    smtpPass: "",
    hasSmtpPass: !!s.smtpPass,
    // 槽位地址永不下发浏览器，只回传 id / label / hasUrl（hasUrl 不参与保存过滤）
    redisSlots: s.redisSlots.map((r) => ({ id: r.id, url: "", label: r.label ?? "", hasUrl: !!r.url })),
    redisUrl: "",
    hasRedisUrl: !!s.redisUrl,
  };
}

// 上传大小上限：站点设置优先，环境变量兜底
export function envMaxUploadMB(): number {
  return Number(process.env.MAX_UPLOAD_MB ?? 50);
}
