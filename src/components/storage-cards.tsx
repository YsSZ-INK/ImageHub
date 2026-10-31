"use client";

import { useEffect, useState } from "react";
import { QuotaBar } from "@/components/quota-bar";
import { R2UsageCard } from "@/components/r2-usage-card";
import { formatBytes } from "@/lib/utils";

export type StorageCardsSnapshot = {
  quota: number;
  localUsed: number;
  localCount: number;
  slots: { marker: string; label: string; used: number; count: number }[];
};

// 侧栏存储卡片：服务端渲染初始值 + 客户端每 10 秒轮询局部刷新
// 迁移/上传后的占用变化自动呈现，无需整页 reload；页面隐藏时暂停轮询
export function StorageCards({ initial, isAdmin }: { initial: StorageCardsSnapshot; isAdmin: boolean }) {
  const [snap, setSnap] = useState(initial);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      fetch("/api/storage/usage")
        .then((r) => r.json())
        .then((json) => {
          if (json.ok) setSnap(json.data as StorageCardsSnapshot);
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <QuotaBar used={snap.localUsed} quota={snap.quota} />
      {/* 本地磁盘占用：迁移到 R2 后此卡片数字下降（VPS 空间释放） */}
      <div className="mt-3 rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-medium">本地磁盘占用</p>
        <p className="text-xs text-muted-foreground">
          已用 {formatBytes(snap.localUsed)} · {snap.localCount} 个文件
        </p>
      </div>
      {snap.slots.map((s) => (
        <R2UsageCard
          key={s.marker}
          marker={s.marker}
          label={s.label}
          used={s.used}
          count={s.count}
          isAdmin={isAdmin}
        />
      ))}
    </>
  );
}
