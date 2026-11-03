"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/image-grid";
import { Pager } from "@/components/pager";
import { useCursorPager } from "@/lib/use-cursor-pager";

// 回收站：软删除图片，游标分页（可跳页）+ 全选（跨页）+ 恢复/彻底删除
export function TrashClient() {
  // 游标分页：翻页/跳页逻辑统一在 hook 内
  const { items, page, hasNext, loading, loadPage, gotoPage, total } = useCursorPager({ scope: "trash" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 全选所有（含未加载页）：拉取回收站内全部图片 id
  async function selectAll() {
    setPicking(true);
    try {
      const res = await fetch("/api/images/ids?scope=trash");
      const json = await res.json();
      if (json.ok) {
        setSelected(new Set<string>(json.data.ids));
        toast.success(`已选中全部 ${json.data.ids.length} 张`);
      } else toast.error(json.error);
    } catch {
      toast.error("网络错误，请稍后再试");
    } finally {
      setPicking(false);
    }
  }

  // 全选/取消全选合一：选中数达到回收站总数即视为已全选
  const allPicked = selected.size > 0 && total != null && selected.size >= total;

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

      {/* 工具栏：全选/取消全选切换 + 批量操作（常驻显示，未选中时禁用） */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          size="sm"
          variant="outline"
          className="text-sm"
          disabled={loading || picking}
          onClick={() => (allPicked ? setSelected(new Set()) : selectAll())}
          title={allPicked ? "取消全部选中" : "选中回收站内所有图片（含未加载页）"}
        >
          {allPicked ? "取消全选" : "全选"}
        </Button>
        <span className="text-sm text-muted-foreground">已选 {selected.size} 张</span>
        <Button size="sm" variant="outline" className="text-sm" disabled={loading || selected.size === 0} onClick={() => batch("restore")}>
          <RotateCcw className="h-4 w-4" /> 恢复
        </Button>
        <Button size="sm" variant="destructive" className="text-sm" disabled={loading || selected.size === 0} onClick={() => batch("purge")}>
          <Trash2 className="h-4 w-4" /> 彻底删除
        </Button>
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
                {/* 勾选按钮：未选中任何图片时 hover 才显示；本卡片已选中或页面有选中时常驻 */}
                <label
                  className={`absolute left-2 top-2 cursor-pointer transition-opacity ${
                    selected.has(img.id) || selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
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

          {/* 翻页：支持输入页码跳转 */}
          {(page > 1 || hasNext) && <Pager page={page} hasNext={hasNext} disabled={loading} onGo={gotoPage} />}
        </>
      )}
    </div>
  );
}
