/**
 * 存储适配层接口：业务代码只依赖此抽象。
 * 实现：local（本地磁盘，单机部署）、r2（Cloudflare R2，S3 兼容对象存储）
 */
import { getSettings } from "@/lib/settings";
import { AppError } from "@/lib/api";

export interface PutOptions {
  contentType: string;
}

export interface Storage {
  put(key: string, data: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
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

function getR2Storage(cfg: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }): Promise<Storage> {
  const cacheKey = `${cfg.accountId}:${cfg.accessKeyId}:${cfg.bucket}`;
  let cached = r2Cache.get(cacheKey);
  if (!cached) {
    cached = import("./r2").then((m) => new m.R2Storage(cfg));
    r2Cache.set(cacheKey, cached);
  }
  return cached;
}

// R2 槽位显示名（R2 一 / R2 二 / …），供设置页、迁移与用量卡片共用
const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
export function r2SlotLabel(index: number): string {
  return `R2 ${CN_NUM[index] ?? index + 1}`;
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
    if (!cfg || !cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
      throw new AppError(`${r2SlotLabel(idx)}未配置完整，请在站点设置中补全`, 500);
    }
    return getR2Storage(cfg);
  }
  return getLocalStorage();
}

// 当前站点设置的默认存储（新上传写入用）
export async function getStorage(): Promise<Storage> {
  const s = await getSettings();
  if (s.storageDriver === "r2") return getStorageFor(`r2:${s.r2UploadSlot}`);
  return getLocalStorage();
}

// 当前上传目标的位置标记（写入 Image.storage 用）
export async function getUploadMarker(): Promise<string> {
  const s = await getSettings();
  return s.storageDriver === "r2" ? `r2:${s.r2UploadSlot}` : "local";
}
