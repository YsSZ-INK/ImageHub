"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Lightbox } from "@/components/lightbox";
import { VisibilityBadge, ImageActions, RestoreButton } from "@/components/image-actions";
import type { ImageDTO } from "@/server/image.service";

// 图片网格：waterfall（CSS columns 瀑布流）或 grid（等比方格）
export function ImageGrid({
  items,
  layout = "waterfall",
  showOwner = false,
  showActions = false,
  showVisibility = false,
  trash = false,
  onChanged,
}: {
  items: ImageDTO[];
  layout?: "waterfall" | "grid";
  showOwner?: boolean;
  showActions?: boolean;
  showVisibility?: boolean;
  trash?: boolean;
  onChanged?: () => void;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

  const visible = items.filter((i) => !failed.has(i.id));
  const card = (img: ImageDTO) => (
    <figure
      key={img.id}
      className="group relative overflow-hidden rounded-xl border border-border/70 bg-muted/30 transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg hover:shadow-foreground/10"
    >
      {/* 缩略图走受保护路由；blurhash 占位 */}
      {failed.has(img.id) ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <ImageOff className="h-6 w-6" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.thumbUrl}
          alt={img.filename}
          loading="lazy"
          onClick={() => setLightbox(items.indexOf(img))}
          onError={() => setFailed((s) => new Set(s).add(img.id))}
          className={`w-full cursor-zoom-in bg-muted object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] ${layout === "grid" ? "aspect-square" : ""}`}
          style={
            layout === "waterfall" && img.blurhash
              ? { background: `linear-gradient(135deg, #666 0%, #999 100%)` }
              : undefined
          }
        />
      )}
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-1 items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="min-w-0 pointer-events-auto">
          <p className="truncate text-xs text-white">{img.filename}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            {showVisibility && <VisibilityBadge visibility={img.visibility} />}
            {showOwner && img.ownerName && <span className="text-[10px] text-white/70">{img.ownerName}</span>}
          </div>
        </div>
        <div className="pointer-events-auto shrink-0">
          {trash ? <RestoreButton id={img.id} onDone={() => onChanged?.()} /> : showActions && <ImageActions id={img.id} onDelete={onChanged} />}
        </div>
      </figcaption>
    </figure>
  );

  return (
    <>
      {layout === "waterfall" ? <div className="masonry">{items.map(card)}</div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{items.map(card)}</div>}
      {lightbox !== null && visible.length > 0 && (
        <Lightbox
          images={items}
          index={Math.min(lightbox, items.length - 1)}
          onClose={() => setLightbox(null)}
          onNavigate={setLightbox}
        />
      )}
    </>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="anim-fade-up flex flex-col items-center justify-center rounded-2xl border border-dashed border-foreground/15 bg-background/40 py-20 text-center backdrop-blur-sm">
      <span className="flex h-14 w-14 -rotate-2 items-center justify-center rounded-[6px] border border-seal/30 bg-seal/10">
        <ImageOff className="h-6 w-6 text-seal" />
      </span>
      <h3 className="font-display mt-5 text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
