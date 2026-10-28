/**
 * 存储适配层接口：业务代码只依赖此抽象。
 * 实现：local（本地磁盘，单机部署）
 */
export interface PutOptions {
  contentType: string;
}

export interface Storage {
  put(key: string, data: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

let cached: Promise<Storage> | null = null;

export function getStorage(): Promise<Storage> {
  cached ??= import("./local").then((m) => new m.LocalStorage());
  return cached;
}
