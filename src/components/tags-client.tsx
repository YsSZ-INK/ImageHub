"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/image-grid";
import type { ImageDTO } from "@/server/image.service";

type Tag = { id: string; name: string; imageCount: number };

// 标签管理：增删改
export function TagsClient() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tags");
      const json = await res.json();
      if (json.ok) setTags(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        setName("");
        toast.success("标签已创建");
        load();
      } else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  }

  async function rename(id: string) {
    if (!editingName.trim()) return;
    const res = await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName.trim() }),
    });
    const json = await res.json();
    if (json.ok) {
      setEditingId(null);
      toast.success("已重命名");
      load();
    } else toast.error(json.error);
  }

  async function remove(t: Tag) {
    if (!confirm(`删除标签「${t.name}」？图片不会被删除。`)) return;
    const res = await fetch(`/api/tags/${t.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      toast.success("已删除");
      load();
    } else toast.error(json.error);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">标签管理</h1>

      <div className="flex max-w-md gap-2">
        <Input
          placeholder="新标签名称"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <Button onClick={create} disabled={saving || !name.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : <Plus className="h-4 w-4" />} 创建
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : tags.length === 0 ? (
        <EmptyState title="还没有标签" description="创建标签来分类图片，可在批量操作中打标签" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) =>
            editingId === t.id ? (
              <span key={t.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
                <Input
                  className="h-6 w-28 text-xs"
                  value={editingName}
                  autoFocus
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && rename(t.id)}
                />
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => rename(t.id)}>
                  保存
                </Button>
              </span>
            ) : (
              <span key={t.id} className="group flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                {t.name}
                <span className="text-xs text-muted-foreground">{t.imageCount}</span>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="重命名"
                  onClick={() => {
                    setEditingId(t.id);
                    setEditingName(t.name);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button className="text-muted-foreground hover:text-destructive" aria-label="删除" onClick={() => remove(t)}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
