// 缩略图两级缓存：内存 LRU → 磁盘持久缓存（storage/.thumbs/）→ 回源对象存储
// - 内存命中：微秒级；磁盘命中：毫秒级（免一次 R2/OSS 跨网回源，国内访问 R2 尤其明显）
// - 磁盘缓存持久存在（服务重启不丢，冷启动也快）；仅受磁盘容量约束，可在运维时整目录清理
// - 并发去重：画廊一次挂载几十张缩略图，同 key 回源只发生一次
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { storageRoot } from "@/lib/storage/local";

const MAX_BYTES = 128 * 1024 * 1024;

const map = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer>>();
let totalBytes = 0;

function touch(key: string, buf: Buffer) {
  map.delete(key);
  map.set(key, buf);
}

function store(key: string, buf: Buffer) {
  if (!map.has(key)) totalBytes += buf.length;
  touch(key, buf);
  // 超上限时从最旧开始淘汰（Map 迭代序即插入序）
  while (totalBytes > MAX_BYTES && map.size > 1) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    totalBytes -= map.get(oldest)!.length;
    map.delete(oldest);
  }
}

// 磁盘缓存路径：key 哈希为文件名（key 含存储标记与对象键，无路径注入风险）
function diskPath(key: string) {
  const hash = createHash("sha1").update(key).digest("hex");
  return path.join(storageRoot(), ".thumbs", `${hash}.webp`);
}

async function readDisk(key: string): Promise<Buffer | null> {
  try {
    const buf = await fs.readFile(diskPath(key));
    if (buf.length > 0) return buf;
    return null;
  } catch {
    return null;
  }
}

async function writeDisk(key: string, buf: Buffer) {
  try {
    const p = diskPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, buf);
  } catch {
    // 磁盘写失败不影响服务（下次仍走回源）
  }
}

export function getThumb(key: string, loader: () => Promise<Buffer>): Promise<Buffer> {
  const hit = map.get(key);
  if (hit) {
    touch(key, hit);
    return Promise.resolve(hit);
  }
  const running = inflight.get(key);
  if (running) return running;
  const task = (async () => {
    // 先查磁盘持久缓存：命中则回填内存，免跨网回源
    const disk = await readDisk(key);
    if (disk) {
      store(key, disk);
      inflight.delete(key);
      return disk;
    }
    const buf = await loader();
    store(key, buf);
    void writeDisk(key, buf);
    inflight.delete(key);
    return buf;
  })().catch((err) => {
    inflight.delete(key);
    throw err;
  });
  inflight.set(key, task);
  return task;
}

// 上传时已生成好缩略图：直接进两级缓存，首次访问零生成
export function prewriteThumb(key: string, buf: Buffer) {
  store(key, buf);
  void writeDisk(key, buf);
}

// 一天一清：本地缩略图缓存每天整目录清空一次，之后访问自动从原图重建
const CLEAN_MS = 24 * 60 * 60 * 1000;
async function cleanAll() {
  map.clear();
  inflight.clear();
  totalBytes = 0;
  try {
    await fs.rm(path.join(storageRoot(), ".thumbs"), { recursive: true, force: true });
  } catch {
    // 清理失败不影响服务
  }
}
void setInterval(() => void cleanAll(), CLEAN_MS).unref();
