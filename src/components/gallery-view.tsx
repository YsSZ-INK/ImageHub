"use client";

import { useState } from "react";
import { LayoutGrid, Columns3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import type { ImageDTO } from "@/server/image.service";

// 画廊视图：瀑布流/方格切换 + 加载更多（分页）
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
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<"waterfall" | "grid">("waterfall");

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
      params.set("cursor", cursor);
      const res = await fetch(`/api/images?${params}`);
      const json = await res.json();
      if (json.ok) {
        setItems((prev) => [...prev, ...json.data.items]);
        setCursor(json.data.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">共加载 {items.length} 张</p>
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

      {cursor && (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}
