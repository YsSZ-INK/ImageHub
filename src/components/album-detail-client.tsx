"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, FolderMinus, Trash2, X, Pencil, Image as ImageIcon, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlbumFormDialog } from "@/components/album-form-dialog";
import { EmptyState } from "@/components/image-grid";
import { VisibilityBadge } from "@/components/image-actions";
import type { ImageDTO } from "@/server/image.service";

type AlbumInfo = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  coverImageId: string | null;
  imageCount: number;
};

// 相册详情（拥有者）：批量移出相册/设为封面/删除 + 编辑相册
export function AlbumDetailClient({
  album: initialAlbum,
  initialItems,
  initialCursor,
}: {
  album: AlbumInfo;
  initialItems: ImageDTO[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const [album, setAlbum] = useState(initialAlbum);
  const [items, setItems] = useState<ImageDTO[]>(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ scope: "album", albumId: album.id });
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
    },
    [album.id, cursor]
  );

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
        router.refresh();
        load(true);
      } else toast.error(json.error);
    } finally {
      setBatching(false);
    }
  }

  async function batchRemove() {
    await runBatch("album", { albumId: null });
  }

  async function removeOne(imgId: string) {
    setBatching(true);
    try {
      const res = await fetch("/api/images/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [imgId], action: "album", albumId: null }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已移出相册");
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

  async function setCover(imgId: string) {
    if (imgId === album.coverImageId) return;
    setBatching(true);
    try {
      const res = await fetch(`/api/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverImageId: imgId }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已设为封面");
        setAlbum((a) => ({ ...a, coverImageId: imgId }));
        router.refresh();
      } else toast.error(json.error);
    } finally {
      setBatching(false);
    }
  }

  const coverId = album.coverImageId;

  return (
    <div className="space-y-4">
      {/* 相册头部：信息 + 编辑 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href="/dashboard/albums" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> 返回相册管理
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            {album.name}
            <VisibilityBadge visibility={album.visibility} />
          </h1>
          {album.description && <p className="mt-1 text-sm text-muted-foreground">{album.description}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">共 {album.imageCount} 张图片</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" /> 编辑相册
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title="相册里还没有图片" description="在「我的图片」中批量选择图片并移动到该相册" />
      ) : (
        <>
          {/* 批量操作栏：常驻显示，未选中时禁用操作 */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === items.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
              />
              全选
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">已选 {selected.size} 张</span>
              <Button size="sm" variant="outline" disabled={batching || selected.size === 0} onClick={batchRemove}>
                <FolderMinus className="h-4 w-4" /> 移出相册
              </Button>
              <Button size="sm" variant="outline" disabled={batching || selected.size !== 1} onClick={() => setCover([...selected][0])}>
                <ImageIcon className="h-4 w-4" /> 设为封面
              </Button>
              <Button size="sm" variant="destructive" disabled={batching || selected.size === 0} onClick={batchDelete}>
                <Trash2 className="h-4 w-4" /> 删除
              </Button>
              {selected.size > 0 && (
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="取消选择" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* 带复选框的网格 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
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
                  <input type="checkbox" className="h-4 w-4 accent-current" checked={selected.has(img.id)} onChange={() => toggle(img.id)} />
                </label>
                {img.id === coverId && (
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                    <ImageIcon className="h-3 w-3" /> 封面
                  </span>
                )}
                {/* hover 操作：设为封面 / 移出相册 */}
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {img.id !== coverId && (
                    <button
                      type="button"
                      aria-label="设为封面"
                      title="设为封面"
                      disabled={batching}
                      className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 disabled:opacity-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCover(img.id);
                      }}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="移出相册"
                    title="移出相册"
                    disabled={batching}
                    className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOne(img.id);
                    }}
                  >
                    <FolderMinus className="h-3.5 w-3.5" />
                  </button>
                </div>
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

      <AlbumFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        album={{ id: album.id, name: album.name, description: album.description, visibility: album.visibility }}
        onSaved={async () => {
          // 编辑后从相册列表回读，头部名称/描述/可见性立即生效
          try {
            const res = await fetch("/api/albums");
            const json = await res.json();
            if (json.ok) {
              const updated = (json.data as { id: string; name: string; description: string | null; visibility: string; imageCount: number }[]).find(
                (a) => a.id === album.id
              );
              if (updated) setAlbum((a) => ({ ...a, name: updated.name, description: updated.description, visibility: updated.visibility }));
            }
          } catch {
            // 忽略：下次进入页面会刷新
          }
          router.refresh();
        }}
      />
    </div>
  );
}
