"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export type AlbumFormValues = { name: string; description: string; visibility: string };

// 相册创建/编辑弹窗（相册管理页与相册详情页共用）：album 为 null 表示新建
export function AlbumFormDialog({
  open,
  onOpenChange,
  album,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  album: { id: string; name: string; description: string | null; visibility: string } | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AlbumFormValues>({ name: "", description: "", visibility: "PUBLIC" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        album
          ? { name: album.name, description: album.description ?? "", visibility: album.visibility }
          : { name: "", description: "", visibility: "PUBLIC" }
      );
    }
  }, [open, album]);

  async function save() {
    if (!form.name.trim()) {
      toast.error("相册名不能为空");
      return;
    }
    setSaving(true);
    try {
      const url = album ? `/api/albums/${album.id}` : "/api/albums";
      const res = await fetch(url, {
        method: album ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(album ? "已更新" : "已创建");
        onOpenChange(false);
        onSaved();
      } else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{album ? "编辑相册" : "新建相册"}</DialogTitle>
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
              <option value="UNLISTED">有链可见（拿到链接即可看）</option>
              <option value="PRIVATE">私有（仅自己 · 不提供外链）</option>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} 保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
