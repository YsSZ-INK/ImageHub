"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud, LinkIcon, X, Loader2, CheckCircle2, XCircle, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type UploadState = {
  file: File | null;
  name: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

// 上传组件：拖拽 / 点击选择 / 剪贴板粘贴 / URL 远程抓取；多文件并发 + 进度条 + 失败重试
export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<UploadState[]>([]);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  // 上传时自定义标签（对所有本次上传的图片生效）
  const [tagsInput, setTagsInput] = useState("");

  const startUpload = useCallback(
    (file: File): UploadState => ({ file, name: file.name, progress: 0, status: "uploading" }),
    []
  );

  function uploadOne(item: UploadState, idx: number) {
    if (!item.file) return;
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", item.file);
    if (tagsInput.trim()) form.append("tags", tagsInput);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, progress } : it)));
      }
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        const result = json?.data?.results?.[0];
        if (json.ok && result && !result.error) {
          setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: "done", progress: 100 } : it)));
          if (result.deduped) toast.info(`${item.name} 与已有图片重复，已复用`);
        } else {
          const err = result?.error || json.error || "上传失败";
          setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: "error", error: err } : it)));
        }
      } catch {
        setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: "error", error: "服务器响应异常" } : it)));
      }
      router.refresh();
    };
    xhr.onerror = () =>
      setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: "error", error: "网络错误" } : it)));
    xhr.open("POST", "/api/upload");
    xhr.send(form);
  }

  function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (valid.length === 0) {
      toast.error("仅支持图片文件");
      return;
    }
    const newItems = valid.map((f) => ({ file: f, name: f.name, progress: 0, status: "pending" as const }));
    setItems((prev) => [...prev, ...newItems]);
    // 并发上传
    newItems.forEach((item) => {
      setItems((prev) => {
        const idx = prev.findIndex((p) => p === item);
        if (idx >= 0) uploadOne({ ...item, status: "uploading" }, idx);
        return prev;
      });
    });
  }

  // 并发上传辅助：直接按索引逐个触发
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) addFiles(files);
  }

  async function fetchRemote() {
    const url = remoteUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      toast.error("请输入合法的图片 URL");
      return;
    }
    setFetching(true);
    try {
      const res = await fetch("/api/upload/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("抓取成功");
        setRemoteUrl("");
        router.refresh();
      } else toast.error(json.error || "抓取失败");
    } finally {
      setFetching(false);
    }
  }

  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <div className="space-y-4" onPaste={handlePaste} tabIndex={0}>
      <div
        role="button"
        aria-label="上传图片"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-background/40 text-center backdrop-blur-sm transition-all duration-200 hover:border-foreground/30 hover:bg-background/60",
          dragOver && "border-seal bg-seal/5 scale-[1.01]"
        )}
      >
        <UploadCloud className={cn("h-10 w-10 text-muted-foreground transition-transform duration-200", dragOver && "-translate-y-1 text-seal scale-110")} />
        <div>
          <p className="font-medium">拖拽图片到此处，或点击选择文件</p>
          <p className="mt-1 text-xs text-muted-foreground">支持 jpg / png / webp / gif / avif · 支持粘贴 · 多文件并发</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* 自定义标签：随本次上传的所有图片生效 */}
      <div className="relative">
        <Tags className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="自定义标签（可选），逗号分隔，如：风景, 头像 — 对本次上传全部生效"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="或粘贴图片 URL 远程抓取（https://…）"
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchRemote()}
        />
        <Button variant="outline" onClick={fetchRemote} disabled={fetching || !remoteUrl}>
          {fetching ? <Loader2 className="animate-spin" /> : <LinkIcon />}
          抓取
        </Button>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {doneCount}/{items.length} 已完成
          </p>
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
              {item.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-foreground/70" />
              ) : item.status === "error" ? (
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm">{item.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.status === "error" ? item.error : `${item.progress}%`}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      item.status === "error" ? "bg-destructive" : "bg-primary"
                    )}
                    style={{ width: `${item.status === "error" ? 100 : item.progress}%` }}
                  />
                </div>
              </div>
              {item.status === "error" && item.file && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const retry = { ...item, status: "uploading" as const, progress: 0 };
                    setItems((prev) => prev.map((it, idx) => (idx === i ? retry : it)));
                    uploadOne(retry, i);
                  }}
                >
                  重试
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="移除"
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
