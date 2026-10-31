// 原图磁盘缓存（LRU）：看过一次的图片原图落盘 storage/.rawcache/，之后再访问毫秒级直出
// 解决「每次点开都要跨网回源 R2/OSS、网络差时等 20 秒+」的问题
// - 仅缓存较小文件（≤32MB，通常是照片）；视频与超大文件走流式直传，不占磁盘
// - 容量上限 2GB，超限按「最久未访问」淘汰（mtime）
// - key 为 存储标记+对象键 的哈希，Content-Type 由数据库记录提供，与文件扩展名无关
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { storageRoot } from "@/lib/storage/local";

const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // 2GB
export const RAW_CACHE_MAX_FILE = 32 * 1024 * 1024; // 单文件上限

const inflight = new Map<string, Promise<Buffer | null>>();

function cacheDir() {
  return path.join(storageRoot(), ".rawcache");
}

function cachePath(key: string) {
  const hash = createHash("sha1").update(key).digest("hex");
  return path.join(cacheDir(), hash);
}

// 磁盘缓存命中返回内容并 touch mtime（LRU 访问时间）；未命中返回 null
async function readDisk(key: string): Promise<Buffer | null> {
  try {
    const p = cachePath(key);
    const buf = await fs.readFile(p);
    if (buf.length === 0) return null;
    void fs.utimes(p, new Date(), new Date()).catch(() => {});
    return buf;
  } catch {
    return null;
  }
}

// 容量超限时按 mtime 淘汰最旧文件（访问频率低的大缓存先让路）
async function evictIfNeeded(extra: number) {
  try {
    const dir = cacheDir();
    const entries = await fs.readdir(dir);
    let total = extra;
    const stats: { name: string; size: number; mtime: number }[] = [];
    for (const name of entries) {
      const st = await fs.stat(path.join(dir, name)).catch(() => null);
      if (st) {
        total += st.size;
        stats.push({ name, size: st.size, mtime: st.mtimeMs });
      }
    }
    if (total <= MAX_TOTAL) return;
    stats.sort((a, b) => a.mtime - b.mtime);
    for (const f of stats) {
      if (total <= MAX_TOTAL) break;
      await fs.rm(path.join(dir, f.name), { force: true }).catch(() => {});
      total -= f.size;
    }
  } catch {
    // 淘汰失败不影响主流程
  }
}

// 取原图：先查磁盘缓存，未命中执行 loader 回源并异步落盘（loader 失败原样抛出）
export async function getRawCached(key: string, loader: () => Promise<Buffer>): Promise<Buffer> {
  const hit = await readDisk(key);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) {
    const buf = await running;
    if (buf) return buf;
    return loader();
  }
  const task = loader()
    .then(async (buf) => {
      if (buf.length > 0 && buf.length <= RAW_CACHE_MAX_FILE) {
        void (async () => {
          try {
            const p = cachePath(key);
            await fs.mkdir(path.dirname(p), { recursive: true });
            await fs.writeFile(p, buf);
            void evictIfNeeded(buf.length);
          } catch {
            // 写缓存失败不影响响应
          }
        })();
      }
      inflight.delete(key);
      return buf;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, task);
  return task;
}
