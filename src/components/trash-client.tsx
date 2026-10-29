"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import type { ImageDTO } from "@/server/image.service";

// 回收站：软删除图片，游标栈翻页 + 全选本页 + 恢复/彻底删除
export function TrashClient() {
  const [items, setItems] = useState<ImageDTO[]>([]);
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 翻页：游标栈（pageCursors[i] = 请求第 i+1 页所需的 cursor）
  const loadPage = useCallback(
    async (target: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ scope: "trash" });
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
    [pageCursors]
  );

  useEffect(() => {
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function batch(action: "restore" | "purge") {
    if (selected.size === 0) return;
    if (action === "purge" && !confirm(`彻底删除选中的 ${selected.size} 张图片？不可恢复！`)) return;
    const res = await fetch("/api/images/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], action }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success(action === "restore" ? "已恢复" : "已彻底删除");
      setSelected(new Set());
      loadPage(page);
    } else toast.error(json.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">回收站</h1>
        <p className="text-xs text-muted-foreground">回收站内容保留 30 天后自动清理。</p>
      </div>

      {/* 工具栏：全选本页 + 批量操作（常驻显示，未选中时禁用） */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={items.length > 0 && items.every((i) => selected.has(i.id))}
            onChange={(e) => {
              if (e.target.checked) {
                setSelected(new Set([...selected, ...items.map((i) => i.id)]));
              } else {
                const next = new Set(selected);
                items.forEach((i) => next.delete(i.id));
                setSelected(next);
              }
            }}
          />
          全选本页
        </label>
        <span className="text-sm text-muted-foreground">已选 {selected.size} 张</span>
        <Button size="sm" variant="outline" className="text-sm" disabled={loading || selected.size === 0} onClick={() => batch("restore")}>
          <RotateCcw className="h-4 w-4" /> 恢复
        </Button>
        <Button size="sm" variant="destructive" className="text-sm" disabled={loading || selected.size === 0} onClick={() => batch("purge")}>
          <Trash2 className="h-4 w-4" /> 彻底删除
        </Button>
        {selected.size > 0 && (
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="取消选择" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="回收站是空的" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((img) => (
              <div key={img.id} className="relative overflow-hidden rounded-lg border border-border opacity-80">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl}
                  alt={img.filename}
                  loading="lazy"
                  className="aspect-square w-full cursor-pointer bg-muted object-cover"
                  onClick={() => toggle(img.id)}
                />
                <label className="absolute left-2 top-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.has(img.id)}
                    onChange={() => toggle(img.id)}
                  />
                </label>
              </div>
            ))}
          </div>

          {/* 翻页 */}
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
        </>
      )}
    </div>
  );
}
