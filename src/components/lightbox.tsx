"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, ChevronLeft, ChevronRight, Download, Link2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDate, buildSnippets } from "@/lib/utils";
import type { ImageDTO } from "@/server/image.service";

// 灯箱：键盘可操作（← → 切换，ESC 关闭），图片带 alt
export function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: ImageDTO[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(false);
  const img = images[index];
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";

  const prev = useCallback(
    () => onNavigate((index - 1 + images.length) % images.length),
    [index, images.length, onNavigate]
  );
  const next = useCallback(() => onNavigate((index + 1) % images.length), [index, images.length, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key.toLowerCase() === "i") setShowInfo((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, prev, next]);

  if (!img) return null;
  const snippets = buildSnippets(img.id, img.filename, siteUrl);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(snippets.pageUrl);
      toast.success("已复制站内链接（打开需登录）");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-label="图片预览">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm truncate max-w-[50%]">
          {img.filename} <span className="text-white/50">（{index + 1}/{images.length}）</span>
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setShowInfo((v) => !v)} aria-label="信息" className="text-white hover:bg-white/10">
            <Info className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={copyLink} aria-label="复制站内链接" className="text-white hover:bg-white/10">
            <Link2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下载"
            className="text-white hover:bg-white/10"
            onClick={() => router.push(`/api/images/${img.id}/download`)}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭" className="text-white hover:bg-white/10">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={prev}
          aria-label="上一张"
          className="absolute left-2 z-10 text-white hover:bg-white/10 h-10 w-10"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
        {img.kind === "video" ? (
          // 视频：灯箱内直接播放（autoPlay + controls）
          <video
            key={img.id}
            src={img.rawUrl}
            controls
            autoPlay
            playsInline
            className="anim-zoom-in max-h-full max-w-full"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={img.id}
            src={img.rawUrl}
            alt={img.filename}
            className="anim-zoom-in max-h-full max-w-full object-contain select-none"
            draggable={false}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={next}
          aria-label="下一张"
          className="absolute right-2 z-10 text-white hover:bg-white/10 h-10 w-10"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>

        {showInfo && (
          <div className="anim-fade-in absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-black/70 text-white text-xs p-3.5 space-y-1.5 backdrop-blur-md">
            {img.kind !== "video" && <p>尺寸：{img.width} × {img.height}</p>}
            <p>大小：{formatBytes(img.size)}</p>
            <p>格式：{img.mimeType}</p>
            <p>上传：{formatDate(img.createdAt)}</p>
            <p className="text-white/60">← → 切换 · ESC 关闭 · I 显示/隐藏信息</p>
          </div>
        )}
      </div>
    </div>
  );
}
