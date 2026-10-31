import { promises as fs, createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import path from "path";
import type { PutOptions, Storage } from "./index";

// 存储根目录（备份/还原需要直接访问文件系统）
export function storageRoot(): string {
  return path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? "./storage");
}

// 本地磁盘存储实现（开发预览 / 单机部署）
export class LocalStorage implements Storage {
  private base: string;

  constructor() {
    this.base = storageRoot();
  }

  private resolve(key: string): string {
    // 防路径穿越（安全员修复）：仅 startsWith 会把 /app/storage-evil 误判为根内子路径，
    // 解析结果必须是 base 目录本身或位于 base + 路径分隔符之下
    const p = path.resolve(this.base, key);
    if (p !== this.base && !p.startsWith(this.base + path.sep)) throw new Error("非法存储 key");
    return p;
  }

  async put(key: string, data: Buffer, _opts: PutOptions): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }

  // 流式写入：边读边写，内存占用恒定（大视频分片合并后直接入盘）
  async putStream(key: string, stream: Readable, _opts: PutOptions & { size: number }): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await pipeline(stream, createWriteStream(p));
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async getSize(key: string): Promise<number> {
    const st = await fs.stat(this.resolve(key));
    return st.size;
  }

  // 区间流式读取：createReadStream 不整读文件，内存占用恒定
  async getRange(key: string, start: number, endExclusive: number): Promise<{ body: ReadableStream<Uint8Array>; length: number }> {
    const stream = createReadStream(this.resolve(key), { start, end: endExclusive - 1 });
    return { body: Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, length: endExclusive - start };
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
