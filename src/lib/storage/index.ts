/**
 * 存储适配层接口：业务代码只依赖此抽象。
 * 实现：local（本地磁盘，单机部署）、r2（Cloudflare R2，S3 兼容对象存储）
 */
import { getSettings } from "@/lib/settings";
import { AppError } from "@/lib/api";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { prisma } from "@/lib/db";
import { notifySupers } from "@/lib/mailer";
import type { Readable } from "stream";

export interface PutOptions {
  contentType: string;
}

export interface Storage {
  put(key: string, data: Buffer, opts: PutOptions): Promise<void>;
  // 流式写入（分片上传的大文件合并后入库用）：调用方提供总大小，避免 chunked 编码
  putStream(key: string, stream: Readable, opts: PutOptions & { size: number }): Promise<void>;
  get(key: string): Promise<Buffer>;
  // 文件字节数（Range 请求与流式发送前先取总大小）
  getSize(key: string): Promise<number>;
  // 区间读取 [start, endExclusive)：流式返回，不把整个文件读进内存（大视频 Range 请求用）
  getRange(key: string, start: number, endExclusive: number): Promise<{ body: ReadableStream<Uint8Array>; length: number }>;
  // 并行分片整文件读取（可选）：多连接同时回源、按序写出，慢回源网络下下载提速 2-4 倍。
  // 仅用于「无 Range 的整文件流式响应」（下载/直接打开），视频拖动等 Range 请求仍走单区间 getRange。
  getParallelStream?(key: string, total: number): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

let cachedLocal: Promise<Storage> | null = null;

// 本地磁盘驱动（单例）
export function getLocalStorage(): Promise<Storage> {
  cachedLocal ??= import("./local").then((m) => new m.LocalStorage());
  return cachedLocal;
}

// R2 驱动按配置缓存实例（避免每次请求重建 SDK 客户端）
const r2Cache = new Map<string, Promise<Storage>>();

function getR2Storage(cfg: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  region?: string;
}): Promise<Storage> {
  const cacheKey = `${cfg.endpoint ?? ""}|${cfg.accountId}:${cfg.accessKeyId}:${cfg.bucket}:${cfg.region ?? ""}`;
  let cached = r2Cache.get(cacheKey);
  if (!cached) {
    cached = import("./r2").then((m) => new m.R2Storage(cfg));
    r2Cache.set(cacheKey, cached);
  }
  return cached;
}

// 位置标记 → R2 槽位下标（r2:0 / r2:1 / …；兼容早期 r2、r2b）
export function r2SlotIndex(marker: string): number {
  if (marker.startsWith("r2:")) return Number.parseInt(marker.slice(3), 10) || 0;
  if (marker === "r2b") return 1;
  return 0;
}

/**
 * 按记录的位置标记取存储（读路径）：每条图片记录写入时记录了实际存放位置（Image.storage：
 * local 或 r2:<桶下标>），切换配置后旧文件仍按各自位置读写。
 */
export async function getStorageFor(marker: string): Promise<Storage> {
  if (marker === "r2" || marker === "r2b" || marker.startsWith("r2:")) {
    const s = await getSettings();
    const idx = r2SlotIndex(marker);
    const cfg = s.r2Slots[idx];
    // 槽位有效 = 桶与密钥齐全，且端点可推导（R2 有 Account ID / OSS/COS 有 Region / S3 有端点）
    if (!cfg || !cfg.accessKeyId || !cfg.secretAccessKey || !slotConfigured(cfg)) {
      throw new AppError(`${slotDisplayName(cfg, idx, s.r2Slots.length)}未配置完整，请在站点设置中补全`, 500);
    }
    return getR2Storage(cfg);
  }
  return getLocalStorage();
}

// ============ 上传写入：对象存储失败自动降级本地 + 邮件提醒管理员 ============

// 降级提醒去抖：24 小时内最多发一封（Setting 表记录上次发送时间，重启不丢）
const FALLBACK_MAIL_KEY = "lastR2FallbackMailAt";
const FALLBACK_MAIL_INTERVAL = 24 * 3600_000;

async function notifyR2Fallback(marker: string, err: unknown): Promise<void> {
  try {
    const now = Date.now();
    const last = await prisma.setting.findUnique({ where: { key: FALLBACK_MAIL_KEY } });
    if (last && now - Number(last.value) < FALLBACK_MAIL_INTERVAL) return;
    await prisma.setting.upsert({
      where: { key: FALLBACK_MAIL_KEY },
      create: { key: FALLBACK_MAIL_KEY, value: String(now) },
      update: { value: String(now) },
    });
    const s = await getSettings();
    const idx = r2SlotIndex(marker);
    const label = slotDisplayName(s.r2Slots[idx], idx, s.r2Slots.length);
    // 存储降级属基础设施问题：只通知超级管理员
    await notifySupers(
      "【ImageHub】对象存储写入失败，已自动降级到本地磁盘",
      [
        `上传目标 ${label} 写入失败（存储桶已满、欠费或网络异常），本次文件已改为存到服务器本地磁盘。`,
        `错误信息：${err instanceof Error ? err.message : String(err)}`,
        "",
        "建议：到「站点设置 → 存储设置」检查该桶用量与欠费情况；本地磁盘占满配额前请尽快处理。",
        "降级期间存放在本地的文件，可在存储恢复后用「数据迁移」搬回对象存储。",
        "（本提醒 24 小时内最多发送一次）",
      ].join("\n")
    );
  } catch (e) {
    console.error("[storage] 降级邮件提醒失败:", e);
  }
}

/**
 * 上传写入（整包）：按当前设置写到目标存储；目标是对象存储且写入失败（桶满/欠费/网络）时
 * 自动降级写到本地磁盘并邮件提醒管理员（24h 去抖）。返回实际落盘的位置标记。
 */
export async function putUpload(key: string, data: Buffer, opts: PutOptions): Promise<string> {
  const s = await getSettings();
  const useR2 = s.storageDriver === "r2";
  const marker = useR2 ? `r2:${s.r2UploadSlot}` : "local";
  try {
    await (await getStorageFor(marker)).put(key, data, opts);
    return marker;
  } catch (e) {
    if (!useR2) throw e;
    await (await getLocalStorage()).put(key, data, opts);
    void notifyR2Fallback(marker, e);
    return "local";
  }
}

/** 上传写入（流式）：同 putUpload；makeStream 工厂保证降级重试时能拿到一条新流 */
export async function putStreamUpload(key: string, makeStream: () => Readable, opts: PutOptions & { size: number }): Promise<string> {
  const s = await getSettings();
  const useR2 = s.storageDriver === "r2";
  const marker = useR2 ? `r2:${s.r2UploadSlot}` : "local";
  try {
    await (await getStorageFor(marker)).putStream(key, makeStream(), opts);
    return marker;
  } catch (e) {
    if (!useR2) throw e;
    await (await getLocalStorage()).putStream(key, makeStream(), opts);
    void notifyR2Fallback(marker, e);
    return "local";
  }
}
