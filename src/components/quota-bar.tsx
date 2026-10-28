"use client";

import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";

// 存储配额进度条
export function QuotaBar({ used, quota }: { used: number; quota: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(quota, 1)) * 100));
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs font-medium">存储配额</p>
      <Progress value={pct} />
      <p className="mt-2 text-xs text-muted-foreground">
        {formatBytes(used)} / {formatBytes(quota)}（{pct}%）
      </p>
    </div>
  );
}
