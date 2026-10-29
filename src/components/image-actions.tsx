"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Link2, Copy, FileCode, Globe, EyeOff, Lock, Loader2, Trash2, RotateCcw, HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSnippets, cn } from "@/lib/utils";

// 复制片段：全部指向站内需登录页面，绝不生成匿名直链
export function CopyField({ imageId, filename }: { imageId: string; filename: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const s = buildSnippets(imageId, filename, siteUrl);

  async function copy(kind: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success("已复制（打开需登录）");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("复制失败");
    }
  }

  const rows = [
    { icon: Link2, label: "站内图片页链接", value: s.pageUrl },
    { icon: FileCode, label: "Markdown", value: s.markdown },
    { icon: Globe, label: "HTML", value: s.html },
    { icon: Copy, label: "BBCode", value: s.bbcode },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Lock className="h-3 w-3" />
        本站为严格私有图床：链接均指向需登录的站内页面，不含匿名直链
      </p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <r.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            readOnly
            value={r.value}
            className="h-8 flex-1 rounded-md border border-border bg-muted/40 px-2 text-xs text-muted-foreground"
            aria-label={r.label}
          />
          <Button size="sm" variant="outline" onClick={() => copy(r.label, r.value)}>
            {copied === r.label ? "已复制" : "复制"}
          </Button>
        </div>
      ))}
    </div>
  );
}

// 可见性徽标（className 可覆盖默认配色）
export function VisibilityBadge({ visibility, className }: { visibility: string; className?: string }) {
  const map: Record<string, { icon: typeof Globe; text: string; cls: string }> = {
    PUBLIC: { icon: Globe, text: "公开", cls: "bg-zinc-800/5 text-zinc-600 ring-1 ring-zinc-800/10" },
    UNLISTED: { icon: EyeOff, text: "有链可见", cls: "bg-zinc-800/12 text-zinc-700 ring-1 ring-zinc-800/20" },
    PRIVATE: { icon: Lock, text: "私有", cls: "bg-zinc-800 text-zinc-50" },
  };
  const it = map[visibility] ?? map.PUBLIC;
  const Icon = it.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${cn(it.cls, className)}`}>
      <Icon className="h-3 w-3" />
      {it.text}
    </span>
  );
}

// 图片卡内操作按钮（详情/下载/删除）
export function ImageActions({
  id,
  onDelete,
}: {
  id: string;
  onDelete?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function softDelete() {
    if (!confirm("确定移入回收站？")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/images/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        toast.success("已移入回收站（保留 30 天）");
        onDelete?.();
      } else toast.error(json.error);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex gap-1">
      <a href={`/api/images/${id}/download`} title="下载">
        <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-black/60">
          <HardDriveDownload className="h-3.5 w-3.5" />
        </Button>
      </a>
      {onDelete && (
        <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-black/60" onClick={softDelete} title="移入回收站">
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
}

// 恢复按钮（回收站）
export function RestoreButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  async function restore() {
    setLoading(true);
    try {
      const res = await fetch("/api/images/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], action: "restore" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已恢复");
        onDone();
      } else toast.error(json.error);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-black/60" onClick={restore} title="恢复" disabled={loading}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
    </Button>
  );
}
