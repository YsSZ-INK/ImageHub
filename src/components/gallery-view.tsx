"use client";

import { useState } from "react";
import { LayoutGrid, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState, GridSkeleton } from "@/components/image-grid";
import { Pager } from "@/components/pager";
import { useCursorPager } from "@/lib/use-cursor-pager";
import type { ImageDTO } from "@/server/image.service";

// 画廊视图：方格/瀑布流切换 + 翻页浏览（上一页/下一页 + 页码跳转）
// 默认方格：等比方格行对齐，配合每页 24 张（2/4/6 列可整除）不会在右下角留下空位；
// 瀑布流按列高均衡分栏，末列天然可能短一截，需要时再手动切换。
// initialItems 可省略：省略时先渲染骨架，再由 useCursorPager 客户端拉取首屏，
// 用于「页面框架先出来、图片随后加载」的场景（如登录后的画廊页）
export function GalleryView({
  initialItems,
  initialCursor,
  query,
  emptyTitle = "还没有图片",
  emptyDescription,
  showOwner = false,
}: {
  initialItems?: ImageDTO[];
  initialCursor?: string | null;
  query: Record<string, string | undefined>;
  emptyTitle?: string;
  emptyDescription?: string;
  showOwner?: boolean;
}) {
  const [layout, setLayout] = useState<"waterfall" | "grid">("grid");
  const { items, page, hasNext, loading, gotoPage } = useCursorPager(query, { initialItems, initialCursor });

  // 首屏数据未到：先给骨架，避免闪现「画廊还是空的」
  if (items.length === 0 && loading) return <GridSkeleton />;
  if (items.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

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
