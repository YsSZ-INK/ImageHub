"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, Columns3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import type { ImageDTO } from "@/server/image.service";

// 画廊视图：瀑布流/方格切换 + 无限滚动（全部内容呈现在一页，滚动到底自动加载下一批）
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
  const [items, setItems] = useState<ImageDTO[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasNext, setHasNext] = useState(!!initialCursor);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<"waterfall" | "grid">("waterfall");
  const sentinelRef = useRef<HTMLDivElement>(null);
  // query 由服务端页面传入且不变，用 ref 避免对象字面量依赖抖动
  const queryRef = useRef(query);

  const loadMore = useCallback(async () => {
    if (loading || !hasNext) return;
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(queryRef.current)) if (v) sp.set(k, v);
      if (cursor) sp.set("cursor", cursor);
      const res = await fetch(`/api/images?${sp}`);
      const json = await res.json();
      if (json.ok) {
        // 按 id 去重后追加，避免游标波动造成重复卡片
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...json.data.items.filter((i: ImageDTO) => !seen.has(i.id))];
        });
        setCursor(json.data.nextCursor);
        setHasNext(!!json.data.nextCursor);
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error("加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [cursor, hasNext, loading]);

  // 哨兵元素进入视口时加载下一批
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNext) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, loadMore]);

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">共 {items.length} 张</p>
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

      {/* 滚动哨兵：接近底部时自动追加下一批 */}
      {hasNext && <div ref={sentinelRef} className="flex h-16 items-center justify-center text-sm text-muted-foreground" aria-hidden={loading}>
        {loading && (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </>
        )}
      </div>}
    </div>
  );
}
