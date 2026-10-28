"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/image-grid";
import { VisibilityBadge } from "@/components/image-actions";

type Album = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  imageCount: number;
};

// 相册管理：创建/重命名/删除
export function AlbumsClient() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Album | null>(null);
  const [form, setForm] = useState({ name: "", description: "", visibility: "PUBLIC" });
  const [saving, setSaving] = useState(false);

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

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", visibility: "PUBLIC" });
    setOpen(true);
  }

  function openEdit(a: Album) {
    setEditing(a);
    setForm({ name: a.name, description: a.description ?? "", visibility: a.visibility });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error("相册名不能为空");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/albums/${editing.id}` : "/api/albums";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(editing ? "已更新" : "已创建");
        setOpen(false);
        load();
      } else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Album) {
    if (!confirm(`删除相册「${a.name}」？相册内图片不会被删除。`)) return;
    const res = await fetch(`/api/albums/${a.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      toast.success("已删除");
      load();
    } else toast.error(json.error);
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
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> 新建相册
        </Button>
      </div>

      {albums.length === 0 ? (
        <EmptyState title="还没有相册" description="创建相册来整理你的图片" action={<Button onClick={openCreate}>新建相册</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <div key={a.id} className="rounded-xl border border-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.description || "暂无描述"}</p>
                </div>
                <VisibilityBadge visibility={a.visibility} />
              </div>
              <p className="text-xs text-muted-foreground">{a.imageCount} 张图片</p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                  <Pencil className="h-3 w-3" /> 编辑
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(a)}>
                  <Trash2 className="h-3 w-3" /> 删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑相册" : "新建相册"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="album-name">名称</Label>
              <Input id="album-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={50} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="album-desc">描述</Label>
              <Textarea id="album-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label>可见性</Label>
              <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                <option value="PUBLIC">公开（登录用户可见）</option>
                <option value="UNLISTED">有链可见</option>
                <option value="PRIVATE">私有</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
