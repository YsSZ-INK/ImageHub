"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";

// R2 免费额度（每月包含的存储量），超出部分按量计费
const R2_FREE_BYTES = 10 * 1024 ** 3;

/**
 * 左下角 R2 存储用量卡片（每个已配置的 R2 桶一张）：
 * 默认显示按数据库聚合的站点文件用量（即时、随页面渲染）；
 * 管理员可点击刷新按钮查询桶内实时用量（ListObjectsV2 枚举，桶很大时耗时）。
 */
export function R2UsageCard({
  marker,
  label,
  used,
  count,
  isAdmin,
}: {
  marker: string;
  label: string;
  used: number;
  count: number;
  isAdmin: boolean;
}) {
  const [live, setLive] = useState<{ bytes: number; objects: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/storage/usage?slot=${encodeURIComponent(marker)}`);
      const json = await res.json();
      if (json.ok) {
        setLive(json.data);
        toast.success(`${label}桶内实时用量：${formatBytes(json.data.bytes)} · ${json.data.objects} 个对象`);
      } else toast.error(json.error);
    } catch {
      toast.error("用量查询请求失败");
    } finally {
      setLoading(false);
    }
  }

  const showUsed = live ? live.bytes : used;
  const showCount = live ? live.objects : count;
  const pct = Math.min(100, Math.round((showUsed / R2_FREE_BYTES) * 100));

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium">{label}存储用量</p>
        {isAdmin && (
          <button
            onClick={refresh}
            disabled={loading}
            title="查询桶内实时用量"
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      <Progress value={pct} />
      <p className="mt-2 text-xs text-muted-foreground">
        已用 {formatBytes(showUsed)} / 上限 10 GB · {showCount} 个文件{live ? "（桶内实时）" : ""}（{pct}%）
      </p>
    </div>
  );
}
