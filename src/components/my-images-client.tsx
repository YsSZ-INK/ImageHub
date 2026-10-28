"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, FolderPlus, Tags, Eye, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ImageDTO } from "@/server/image.service";

// 我的图片：多选 + 批量操作（删除/移动相册/打标签/改可见性）
export function MyImagesClient({ albums, tags }: { albums: { id: string; name: string }[]; tags: { id: string; name: string }[] }) {
  const router = useRouter();
  const [items, setItems] = useState<ImageDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [dialog, setDialog] = useState<"album" | "tag" | null>(null);
  const [albumId, setAlbumId] = useState("");
  const [tagId, setTagId] = useState("");

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope: "mine" });
      if (!reset && cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/images?${params}`);
      const json = await res.json();
      if (json.ok) {
        setItems((prev) => (reset ? json.data.items : [...prev, ...json.data.items]));
        setCursor(json.data.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    load(true);
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

  async function runBatch(action: string, extra?: Record<string, unknown>) {
    if (selected.size === 0) return;
    setBatching(true);
    try {
      const res = await fetch("/api/images/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, ...extra }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`已处理 ${json.data.affected} 张图片`);
        setSelected(new Set());
        setDialog(null);
        router.refresh();
        load(true);
      } else toast.error(json.error);
    } finally {
      setBatching(false);
    }
  }

  async function batchDelete() {
    if (!confirm(`确定把选中的 ${selected.size} 张图片移入回收站？`)) return;
    await runBatch("delete");
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && !loading ? (
        <EmptyState title="还没有图片" description="去上传你的第一张图片吧" />
      ) : (
        <>
          {/* 多选模式 */}
          <div className="flex items-center gap-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === items.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
              />
              全选
            </label>
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">已选 {selected.size} 张</span>
                <Button size="sm" variant="outline" disabled={batching} onClick={() => setDialog("album")}>
                  <FolderPlus className="h-3.5 w-3.5" /> 移动相册
                </Button>
                <Button size="sm" variant="outline" disabled={batching} onClick={() => setDialog("tag")}>
                  <Tags className="h-3.5 w-3.5" /> 打标签
                </Button>
                <Select
                  className="h-8 w-32 text-xs"
                  value=""
                  disabled={batching}
                  onChange={(e) => e.target.value && runBatch("visibility", { visibility: e.target.value })}
                >
                  <option value="">设置可见性…</option>
                  <option value="PUBLIC">公开（登录可见）</option>
                  <option value="UNLISTED">有链可见</option>
                  <option value="PRIVATE">私有</option>
                </Select>
                <Button size="sm" variant="destructive" disabled={batching} onClick={batchDelete}>
                  <Trash2 className="h-3.5 w-3.5" /> 删除
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="取消选择" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* 带复选框的网格 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-lg border border-border">
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
                    className="h-4 w-4 accent-current"
                    checked={selected.has(img.id)}
                    onChange={() => toggle(img.id)}
                  />
                </label>
                <p className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent p-1.5 text-xs text-white opacity-0 group-hover:opacity-100">
                  {img.filename}
                </p>
              </div>
            ))}
          </div>

          {cursor && (
            <div className="flex justify-center py-4">
              <Button variant="outline" onClick={() => load(false)} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : null} 加载更多
              </Button>
            </div>
          )}
        </>
      )}

      {/* 移动相册 / 打标签弹窗 */}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialog === "album" ? "移动到相册" : "添加标签"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {dialog === "album" ? (
              <Select value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
                <option value="">选择相册…</option>
                {albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">选择标签…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                disabled={batching || (dialog === "album" ? !albumId : !tagId)}
                onClick={() =>
                  dialog === "album"
                    ? runBatch("album", { albumId: albumId || null })
                    : runBatch("tag", { tagId })
                }
              >
                {batching ? <Loader2 className="animate-spin" /> : null} 确定
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
