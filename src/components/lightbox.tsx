"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, ChevronLeft, ChevronRight, Download, Link2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDate, buildSnippets, preloadRaw } from "@/lib/utils";
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
  // 灯箱用 Portal 渲染到 body：祖先（main 等）带 transform 时 fixed 会相对祖先而非视口定位，
  // 导致图片偏移——Portal 保证定位基准永远是视口
  const [portalReady, setPortalReady] = useState(false);
  // 加载状态：预览档（2560px）就绪先显示，原图就绪后替换；缓存命中时原图瞬间直出
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [hdLoaded, setHdLoaded] = useState(false);
  // 原图回源失败（网络差超时）自动重试：key 变化触发重新加载，最多 2 次
  const [hdRetry, setHdRetry] = useState(0);
  const img = images[index];
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    setPreviewLoaded(false);
    setHdLoaded(false);
    setHdRetry(0);
  }, [img?.id]);

  // 相邻原图预取：显示当前图的同时后台加载前后各一张，翻页即显高清
  useEffect(() => {
    [images[index + 1], images[index - 1]].forEach((n) => {
      if (n && !n.mimeType.startsWith("video/")) preloadRaw(n.rawUrl);
    });
  }, [index, images]);

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

  useEffect(() => {
    setPortalReady(true);
  }, []);

  if (!portalReady || !img) return null;
  const snippets = buildSnippets(img.id, img.filename, siteUrl);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(snippets.pageUrl);
      toast.success("已复制站内链接（打开需登录）");
    } catch {
      toast.error("复制失败");
    }
  }

  return createPortal(
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
          /* 预览档垫底（1600px WebP，几百 KB，秒级就绪）+ 原图覆盖（就绪后无缝替换）。
             容器恒定占满内容区、inset-0 m-auto 居中：加载前后图片位置零跳变 */
          <div className="relative h-full w-full">
            {!previewLoaded && !hdLoaded && (
              <Loader2 className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/40" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!hdLoaded && (
              <img
                key={`${img.id}-pv`}
                src={`${img.thumbUrl}?w=2560`}
                alt=""
                aria-hidden
                onLoad={() => setPreviewLoaded(true)}
                className={`anim-zoom-in absolute inset-0 m-auto max-h-full max-w-full object-contain select-none transition-opacity duration-200 ${
                  previewLoaded ? "opacity-100" : "opacity-0"
                }`}
                draggable={false}
              />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`${img.id}-${hdRetry}`}
              src={img.rawUrl}
              alt={img.filename}
              onLoad={() => setHdLoaded(true)}
              onError={() => {
                if (hdRetry < 2) setTimeout(() => setHdRetry((n) => n + 1), 8000);
              }}
              className={`anim-zoom-in absolute inset-0 m-auto max-h-full max-w-full object-contain select-none transition-opacity duration-300 ${
                hdLoaded ? "opacity-100" : "opacity-0"
              }`}
              draggable={false}
            />
          </div>
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
    </div>,
    document.body
  );
}
