"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Pencil, FolderOpen, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlbumFormDialog } from "@/components/album-form-dialog";
import { EmptyState } from "@/components/image-grid";
import { VisibilityBadge } from "@/components/image-actions";

type Album = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  imageCount: number;
  coverUrl: string | null;
  createdAt: string;
};

// 相册管理：列表（封面/进入相册）+ 创建/编辑/删除
export function AlbumsClient() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Album | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/albums");
      const json = await res.json();
      if (json.ok) setAlbums(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(a: Album) {
    if (!confirm(`删除相册「${a.name}」？相册内图片不会被删除。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/albums/${a.id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        toast.success("已删除");
        load();
      } else toast.error(json.error);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">相册管理</h1>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> 新建相册
        </Button>
      </div>

      {albums.length === 0 ? (
        <EmptyState
          title="还没有相册"
          description="创建相册来整理你的图片"
          action={<Button onClick={() => { setEditing(null); setOpen(true); }}>新建相册</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {albums.map((a) => (
            <div
              key={a.id}
              className="group overflow-hidden rounded-xl border border-foreground/10 bg-background/55 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg hover:shadow-foreground/10"
            >
              {/* 封面：可点击进入相册 */}
              <Link href={`/albums/${a.id}`} className="relative block aspect-[3/2] overflow-hidden bg-muted/30">
                {a.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.coverUrl}
                    alt={a.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                    <FolderOpen className="h-10 w-10" />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 text-xs text-white">
                  <ImageIcon className="h-3.5 w-3.5" /> {a.imageCount} 张图片
                </span>
              </Link>
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/albums/${a.id}`} className="block truncate font-medium hover:underline">
                      {a.name}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">{a.description || "暂无描述"}</p>
                  </div>
                  <VisibilityBadge visibility={a.visibility} />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString("zh-CN")}</p>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(a); setOpen(true); }}>
                      <Pencil className="h-3 w-3" /> 编辑
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={deleting} onClick={() => remove(a)}>
                      <Trash2 className="h-3 w-3" /> 删除
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlbumFormDialog
        open={open}
        onOpenChange={setOpen}
        album={editing ? { id: editing.id, name: editing.name, description: editing.description, visibility: editing.visibility } : null}
        onSaved={load}
      />
    </div>
  );
}
