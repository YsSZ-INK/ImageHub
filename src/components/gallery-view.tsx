"use client";

import { useCallback, useState } from "react";
import { LayoutGrid, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import type { ImageDTO } from "@/server/image.service";

// 画廊视图：瀑布流/方格切换 + 游标栈翻页（与「我的图片」一致）
export function GalleryView({
  initialItems,
  initialCursor,
  query,
  emptyTitle = "还没有图片",
  emptyDescription,
  showOwner = false,
}: {
  initialItems: ImageDTO[];
  initialCursor: string | null;
  query: Record<string, string | undefined>;
  emptyTitle?: string;
  emptyDescription?: string;
  showOwner?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  // 游标栈：pageCursors[i] = 请求第 i+1 页所需的 cursor（首页为 null，第 2 页游标来自服务端首屏）
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null, initialCursor]);
  const [hasNext, setHasNext] = useState(!!initialCursor);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<"waterfall" | "grid">("waterfall");

  const loadPage = useCallback(
    async (target: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
        const c = pageCursors[target - 1];
        if (c) params.set("cursor", c);
        const res = await fetch(`/api/images?${params}`);
        const json = await res.json();
        if (json.ok) {
          // 当前页被删空且不是第一页时，回退一页
          if (json.data.items.length === 0 && target > 1) {
            setPageCursors((prev) => prev.slice(0, target));
            setLoading(false);
            return loadPage(target - 1);
          }
          setItems(json.data.items);
          setPage(target);
          setHasNext(!!json.data.nextCursor);
          if (json.data.nextCursor) {
            setPageCursors((prev) => {
              const next = [...prev];
              next[target] = json.data.nextCursor;
              return next;
            });
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      } finally {
        setLoading(false);
      }
    },
    [pageCursors, query]
  );

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">本页 {items.length} 张</p>
        <div className="flex gap-1">
          <Button variant={layout === "waterfall" ? "secondary" : "ghost"} size="icon" aria-label="瀑布流" onClick={() => setLayout("waterfall")}>
            <Columns3 className="h-4 w-4" />
          </Button>
          <Button variant={layout === "grid" ? "secondary" : "ghost"} size="icon" aria-label="方格" onClick={() => setLayout("grid")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ImageGrid items={items} layout={layout} showOwner={showOwner} showVisibility={false} />

      {(page > 1 || hasNext) && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Button variant="outline" size="sm" disabled={loading || page === 1} onClick={() => loadPage(page - 1)}>
            上一页
          </Button>
          <span className="min-w-16 text-center text-sm text-muted-foreground">第 {page} 页</span>
          <Button variant="outline" size="sm" disabled={loading || !hasNext} onClick={() => loadPage(page + 1)}>
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
