"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import type { ImageDTO } from "@/server/image.service";

// 回收站：软删除图片，支持恢复与彻底删除
export function TrashClient() {
  const [items, setItems] = useState<ImageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/images?scope=trash");
      const json = await res.json();
      if (json.ok) setItems(json.data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      load();
    } else toast.error(json.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">回收站</h1>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => batch("restore")}>
              恢复选中（{selected.size}）
            </Button>
            <Button size="sm" variant="destructive" onClick={() => batch("purge")}>
              彻底删除
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">回收站内容保留 30 天后自动清理。</p>

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
                  onClick={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (next.has(img.id)) next.delete(img.id);
                      else next.add(img.id);
                      return next;
                    })
                  }
                />
                <label className="absolute left-2 top-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.has(img.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(img.id)) next.delete(img.id);
                        else next.add(img.id);
                        return next;
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
