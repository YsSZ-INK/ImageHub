import { promises as fs } from "fs";
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
    // 防路径穿越
    const p = path.resolve(this.base, key);
    if (!p.startsWith(this.base)) throw new Error("非法存储 key");
    return p;
  }

  async put(key: string, data: Buffer, _opts: PutOptions): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
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
