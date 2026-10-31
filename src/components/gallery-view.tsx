"use client";

import { useState } from "react";
import { LayoutGrid, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import { Pager } from "@/components/pager";
import { useCursorPager } from "@/lib/use-cursor-pager";
import type { ImageDTO } from "@/server/image.service";

// 画廊视图：瀑布流/方格切换 + 翻页浏览（上一页/下一页 + 页码跳转，每页 60 张）
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
  const [layout, setLayout] = useState<"waterfall" | "grid">("waterfall");
  const { items, page, hasNext, loading, gotoPage } = useCursorPager(query, { initialItems, initialCursor });

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">第 {page} 页</p>
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

      <Pager page={page} hasNext={hasNext} disabled={loading} onGo={gotoPage} />
    </div>
  );
}
