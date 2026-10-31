import { prisma } from "@/lib/db";
import { getStorageFor, type Storage } from "@/lib/storage";

export type ReconcileResult = {
  checked: number;
  present: number;
  missing: number;
  unconfigured: number;
  missingIds: string[];
};

// R2 记录一致性校验：逐一确认指向 R2 的记录，其对象在桶中是否真实存在。
// 用于处理「数据库有记录、桶里没文件」的孤儿记录（如曾在 Cloudflare 后台直接清空桶）。
export async function reconcileR2(): Promise<ReconcileResult> {
  const rows = await prisma.image.findMany({
    where: { storage: { startsWith: "r2:" } },
    select: { id: true, storage: true, storageKey: true },
  });
  const res: ReconcileResult = { checked: rows.length, present: 0, missing: 0, unconfigured: 0, missingIds: [] };
  // 同一槽位的存储实例复用；槽位未配置完整时该槽位记录无法校验，单独计数
  const cache = new Map<string, Storage | null>();
  for (const r of rows) {
    if (!cache.has(r.storage)) {
      try {
        cache.set(r.storage, await getStorageFor(r.storage));
      } catch {
        cache.set(r.storage, null);
      }
    }
    const storage = cache.get(r.storage);
    if (!storage) {
      res.unconfigured++;
      continue;
    }
    if (await storage.exists(r.storageKey)) res.present++;
    else {
      res.missing++;
      res.missingIds.push(r.id);
    }
  }
  return res;
}

// 清理缺失记录（仅删除校验结果中确认缺失的记录，二次确认后才执行）
export async function purgeMissingR2(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const del = await prisma.image.deleteMany({
    where: { id: { in: ids }, storage: { startsWith: "r2:" } },
  });
  return del.count;
}
