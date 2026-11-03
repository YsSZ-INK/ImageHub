"use client";

import { useEffect, useState } from "react";
import { QuotaBar } from "@/components/quota-bar";
import { R2UsageCard } from "@/components/r2-usage-card";

export type StorageCardsSnapshot = {
  quota: number;
  localUsed: number;
  localCount: number;
  slots: { marker: string; label: string; used: number; count: number }[];
};

// 侧栏存储卡片：挂载后立即拉一次 + 每 10 秒轮询局部刷新。
// 不在服务端渲染里做全表聚合——每个控制台页面都会复用这层外壳，SSR 聚合会拖慢所有页面首字节。
export function StorageCards({ isAdmin }: { isAdmin: boolean }) {
  const [snap, setSnap] = useState<StorageCardsSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/storage/usage")
        .then((r) => r.json())
        .then((json) => {
          if (alive && json.ok) setSnap(json.data as StorageCardsSnapshot);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 首次数据未到：固定高度占位，避免侧栏底部跳动
  if (!snap) return <div className="h-24 animate-pulse rounded-lg bg-muted/60" />;

  return (
    <>
      <QuotaBar used={snap.localUsed} quota={snap.quota} />
      {snap.slots.map((s) => (
        <R2UsageCard key={s.marker} marker={s.marker} label={s.label} used={s.used} count={s.count} isAdmin={isAdmin} />
      ))}
    </>
  );
}
