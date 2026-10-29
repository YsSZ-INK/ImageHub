"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud, LinkIcon, X, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type UploadState = {
  id: string;
  file: File | null;
  name: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

// 并发池大小：慢上行下过多并发互相挤占带宽，2 个足以填满管道又不互相拖慢
const MAX_CONCURRENT = 2;

// 上传组件：拖拽 / 点击选择 / 剪贴板粘贴 / URL 远程抓取；受控并发 + 进度条 + 失败重试
// onSettled：本批上传全部结束（成功或失败）时触发一次，用于刷新外部列表
export function UploadDropzone({ onSettled }: { onSettled?: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<UploadState[]>([]);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [fetching, setFetching] = useState(false);

  const seqRef = useRef(0);
  const activeRef = useRef(0);
  const startedRef = useRef<Set<string>>(new Set());
  const xhrRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  const allSettled = items.length > 0 && items.every((i) => i.status === "done" || i.status === "error");
  const prevSettled = useRef(false);
  useEffect(() => {
    if (allSettled && !prevSettled.current) {
      prevSettled.current = true;
      onSettled?.();
    }
    if (!allSettled) prevSettled.current = false;
  }, [allSettled, onSettled]);

  function update(id: string, patch: Partial<UploadState>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function uploadOne(id: string, file: File) {
    const xhr = new XMLHttpRequest();
    xhrRef.current.set(id, xhr);
    const form = new FormData();
    form.append("file", file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        update(id, { progress: Math.round((e.loaded / e.total) * 100) });
      }
    };
    const settle = () => {
      xhrRef.current.delete(id);
      activeRef.current = Math.max(0, activeRef.current - 1);
    };
    xhr.onload = () => {
      settle();
      try {
        const json = JSON.parse(xhr.responseText);
        const result = json?.data?.results?.[0];
        if (json.ok && result && !result.error) {
          update(id, { status: "done", progress: 100 });
          if (result.deduped) toast.info(`${file.name} 与已有图片重复，已复用`);
        } else {
          const err = result?.error || json.error || "上传失败";
          update(id, { status: "error", error: err });
        }
      } catch {
        update(id, { status: "error", error: "服务器响应异常" });
      }
      router.refresh();
    };
    xhr.onerror = () => {
      settle();
      update(id, { status: "error", error: "网络错误" });
    };
    xhr.onabort = settle;
    xhr.open("POST", "/api/upload");
    xhr.send(form);
  }

  // 调度器：有空闲名额时从 pending 队列启动上传；startedRef 保证任务只启动一次
  useEffect(() => {
    if (activeRef.current >= MAX_CONCURRENT) return;
    const toStart = items.filter((i) => i.status === "pending" && !startedRef.current.has(i.id) && i.file);
    const slots = MAX_CONCURRENT - activeRef.current;
    const picked = toStart.slice(0, slots);
    if (picked.length === 0) return;
    picked.forEach((it) => startedRef.current.add(it.id));
    activeRef.current += picked.length;
    picked.forEach((it) => uploadOne(it.id, it.file!));
    setItems((prev) => prev.map((p) => (picked.some((t) => t.id === p.id) ? { ...p, status: "uploading" as const } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function addFiles(files: FileList | File[]) {
    // 允许 type 为空的文件（部分应用拖拽时浏览器识别不出 MIME），由服务端魔数校验兜底
    const valid = Array.from(files).filter((f) => !f.type || f.type.startsWith("image/"));
    if (valid.length === 0) {
      toast.error("仅支持图片文件");
      return;
    }
    const newItems = valid.map((f) => ({
      id: `u${++seqRef.current}`,
      file: f,
      name: f.name,
      progress: 0,
      status: "pending" as const,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

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
          <p className="mt-1 text-xs text-muted-foreground">支持 jpg / jpeg / png / webp / gif / avif · 支持粘贴 · 多文件并发</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,.jpg,.jpeg,image/png,image/webp,image/gif,image/avif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
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
                    startedRef.current.delete(item.id);
                    update(item.id, { status: "pending", progress: 0, error: undefined });
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
                onClick={() => {
                  // 上传中先中断请求（onerror 里回收并发名额）
                  xhrRef.current.get(item.id)?.abort();
                  xhrRef.current.delete(item.id);
                  startedRef.current.delete(item.id);
                  setItems((prev) => prev.filter((it) => it.id !== item.id));
                }}
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
