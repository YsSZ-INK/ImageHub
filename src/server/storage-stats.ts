import { prisma } from "@/lib/db";

// 用户本地磁盘占用（配额口径）：仅统计存放在本地磁盘的文件；
// R2 中的文件不占 VPS 空间，也就不占配额。迁移到 R2 后配额自动释放。
export async function localUsageOf(userId: string): Promise<bigint> {
  const agg = await prisma.image.aggregate({ _sum: { size: true }, where: { userId, storage: "local" } });
  // SQLite/PG 下 sum 类型推断不同（number | bigint），统一转 BigInt
  return agg._sum.size == null ? 0n : BigInt(agg._sum.size);
}

export type StorageSnapshot = {
  quota: number;
  localUsed: number;
  localCount: number;
  slots: { marker: string; used: number; count: number }[];
};

// 侧栏存储快照：单次 groupBy 同时取本地与各 R2 槽位占用
// （回收站中的文件仍占磁盘，故不过滤 deletedAt；size 统一转 number 供前端直接使用）
export async function storageSnapshot(userId: string, quota: bigint, slotMarkers: string[]): Promise<StorageSnapshot> {
  const groups = await prisma.image.groupBy({
    by: ["storage"],
    _sum: { size: true },
    _count: true,
    where: { storage: { in: ["local", ...slotMarkers] } },
  });
  const byKey = new Map(groups.map((g) => [g.storage, g]));
  const pick = (key: string) => {
    const g = byKey.get(key);
    return { used: g?._sum.size == null ? 0 : Number(g._sum.size), count: g?._count ?? 0 };
  };
  const local = pick("local");
  return {
    quota: Number(quota),
    localUsed: local.used,
    localCount: local.count,
    slots: slotMarkers.map((m) => ({ marker: m, ...pick(m) })),
  };
}
