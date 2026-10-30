"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ImagePlus, Send, Trash2, ChevronDown, Play, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Lightbox } from "@/components/lightbox";
import { AvatarFallbackIcon } from "@/components/avatar";
import { EmptyState } from "@/components/image-grid";
import { cn } from "@/lib/utils";
import type { ImageDTO } from "@/server/image.service";

type FeedImage = Omit<ImageDTO, "createdAt"> & { createdAt: string };

type FeedPost = {
  id: string;
  caption: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
  images: FeedImage[];
  canDelete: boolean;
};

const MAX_POST_IMAGES = 9;

// 日期显示：精确到年月日时分秒
function formatPostDate(value: string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 图文动态：朋友圈式 feed（发布器 + 时间筛选 + 动态流 + 灯箱预览 + 删除）
export function FeedClient({ me }: { me: { name: string; avatarUrl: string | null } }) {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // 时间筛选（YYYY-MM-DD，空串表示不限）
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // 灯箱：{ images, index } 限定在单条动态内切换
  const [preview, setPreview] = useState<{ images: FeedImage[]; index: number } | null>(null);

  // 本地日期 → 当地起止时刻的 ISO 时间戳（服务端用绝对时刻比较，无时区偏差）

  const load = useCallback(
    async (c?: string | null, f?: string, t?: string) => {
      if (!c) setLoading(true);
      else setLoadingMore(true);
      try {
        const p = new URLSearchParams();
        if (c) p.set("cursor", c);
        if (f) p.set("from", new Date(`${f}T00:00:00`).toISOString());
        if (t) p.set("to", new Date(`${t}T23:59:59.999`).toISOString());
        const qs = p.toString();
        const res = await fetch(`/api/posts${qs ? `?${qs}` : ""}`);
        const json = await res.json();
        if (json.ok) {
          setItems((prev) => (c ? [...prev, ...json.data.items] : json.data.items));
          setCursor(json.data.nextCursor);
          setHasMore(Boolean(json.data.nextCursor));
        } else toast.error(json.error);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    load(null, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, from, to]);

  async function removePost(p: FeedPost) {
    if (!confirm(`删除这条动态？图片仍会保留在相册中。`)) return;
    setDeleting(p.id);
    try {
      const res = await fetch(`/api/posts/${p.id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        toast.success("动态已删除");
        setItems((prev) => prev.filter((i) => i.id !== p.id));
      } else toast.error(json.error);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 xl:max-w-4xl">
      <h1 className="text-xl font-bold">图文动态</h1>

      {/* 时间筛选：按动态发布日期范围过滤 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <Input type="date" className="h-8 w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-muted-foreground">至</span>
        <Input type="date" className="h-8 w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        {(from || to) && (
          <Button variant="outline" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
            清除筛选
          </Button>
        )}
      </div>

      <Composer me={me} onPublished={() => load(null, from, to)} />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="还没有动态" description="发布第一组照片吧" />
      ) : (
        <>
          <div className="space-y-3">
            {items.map((p) => (
              <PostCard key={p.id} post={p} deleting={deleting === p.id} onDelete={removePost} onPreview={setPreview} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => load(cursor, from, to)}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                查看更多
              </Button>
            </div>
          )}
        </>
      )}

      {preview && (
        <Lightbox
          images={preview.images as unknown as ImageDTO[]}
          index={preview.index}
          onClose={() => setPreview(null)}
          onNavigate={(i) => setPreview((pv) => (pv ? { ...pv, index: i } : pv))}
        />
      )}
    </div>
  );
}

// ============ 发布器：文字 + 选择本地图片/视频（逐张上传后创建动态） ============
type Picked = { file: File; url: string; isVideo: boolean };

function Composer({ me, onPublished }: { me: { name: string; avatarUrl: string | null }; onPublished: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState("");

  function addFiles(list: FileList | File[]) {
    // 允许 type 为空的文件（由服务端魔数校验兜底）
    const valid = Array.from(list).filter((f) => !f.type || f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (valid.length === 0) {
      toast.error("仅支持图片/视频文件");
      return;
    }
    const room = MAX_POST_IMAGES - picked.length;
    if (valid.length > room) toast.error(`一条动态最多 ${MAX_POST_IMAGES} 个文件`);
    const accepted = valid.slice(0, Math.max(0, room));
    setPicked((prev) => [
      ...prev,
      ...accepted.map((f) => ({ file: f, url: URL.createObjectURL(f), isVideo: f.type.startsWith("video/") })),
    ]);
  }

  function removeAt(i: number) {
    URL.revokeObjectURL(picked[i].url);
    setPicked((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function publish() {
    if (picked.length === 0) return;
    setPublishing(true);
    try {
      const ids: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        setProgress(`上传中 ${i + 1}/${picked.length}`);
        const form = new FormData();
        form.append("file", picked[i].file);
        const up = await fetch("/api/upload", { method: "POST", body: form });
        const upJson = await up.json();
        if (!upJson.ok) throw new Error(upJson.error || "图片上传失败");
        const r = upJson.data.results[0];
        if (r.error) throw new Error(r.error);
        ids.push(r.id);
      }
      setProgress("发布中…");
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, imageIds: ids }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "发布失败");
      toast.success("已发布");
      picked.forEach((p) => URL.revokeObjectURL(p.url));
      setCaption("");
      setPicked([]);
      onPublished();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发布失败");
    } finally {
      setPublishing(false);
      setProgress("");
    }
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/55 p-4 backdrop-blur-md">
      <div className="flex gap-3">
        <AvatarFallbackIcon name={me.name} url={me.avatarUrl} size={40} />
        <div className="min-w-0 flex-1 space-y-3">
          <Textarea
            placeholder="分享一组照片…"
            value={caption}
            maxLength={1000}
            rows={2}
            onChange={(e) => setCaption(e.target.value)}
            disabled={publishing}
          />
          {picked.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {picked.map((p, i) => (
                <div key={p.url} className="group relative overflow-hidden rounded-lg border border-border">
                  {p.isVideo ? (
                    <>
                      <video src={p.url} preload="metadata" muted playsInline className="aspect-square w-full bg-muted object-cover" />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <Play className="h-6 w-6 fill-white/90 text-white/90 drop-shadow-md" />
                      </span>
                    </>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.url} alt={`待发布 ${i + 1}`} className="aspect-square w-full bg-muted object-cover" />
                  )}
                  <button
                    type="button"
                    aria-label="移除"
                    disabled={publishing}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    onClick={() => removeAt(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,.jpg,.jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,.mp4,.m4v,video/webm,.webm,video/quicktime,.mov,.mkv,video/x-matroska"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={publishing || picked.length >= MAX_POST_IMAGES}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              选择图片/视频{picked.length > 0 ? ` (${picked.length}/${MAX_POST_IMAGES})` : ""}
            </Button>
            <Button size="sm" disabled={publishing || picked.length === 0} onClick={publish}>
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {publishing ? progress || "发布中…" : "发布"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 单条动态：头像 / 昵称 / 文字 / 九宫格 / 日期 / 删除 ============
function PostCard({
  post,
  deleting,
  onDelete,
  onPreview,
}: {
  post: FeedPost;
  deleting: boolean;
  onDelete: (p: FeedPost) => void;
  onPreview: (v: { images: FeedImage[]; index: number }) => void;
}) {
  const n = post.images.length;
  return (
    <article className="rounded-xl border border-foreground/10 bg-background/55 p-4 backdrop-blur-md">
      <div className="flex gap-3">
        <AvatarFallbackIcon name={post.author.name} url={post.author.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{post.author.name}</span>
            {post.canDelete && (
              <button
                type="button"
                aria-label="删除动态"
                title="删除动态"
                disabled={deleting}
                className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                onClick={() => onDelete(post)}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </div>
          {post.caption && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{post.caption}</p>}

          {n === 1 ? (
            post.images[0].kind === "video" ? (
              <div className="relative mt-2 inline-block cursor-pointer" onClick={() => onPreview({ images: post.images, index: 0 })}>
                <video
                  src={post.images[0].rawUrl}
                  preload="metadata"
                  muted
                  playsInline
                  className="max-h-96 max-w-full rounded-lg bg-muted object-contain"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <Play className="h-10 w-10 fill-white/90 text-white/90 drop-shadow-md" />
                </span>
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={post.images[0].thumbUrl}
                alt={post.images[0].filename}
                loading="lazy"
                className="mt-2 max-h-96 max-w-full cursor-pointer rounded-lg bg-muted object-contain"
                onClick={() => onPreview({ images: post.images, index: 0 })}
              />
            )
          ) : (
            <div
              className={cn(
                "mt-2 grid gap-1",
                n === 2 || n === 4 ? "max-w-md grid-cols-2" : "max-w-lg grid-cols-3"
              )}
            >
              {post.images.map((img, i) =>
                img.kind === "video" ? (
                  <div key={img.id} className="relative cursor-pointer" onClick={() => onPreview({ images: post.images, index: i })}>
                    <video
                      src={img.rawUrl}
                      preload="metadata"
                      muted
                      playsInline
                      className="aspect-square w-full rounded-md bg-muted object-cover"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <Play className="h-6 w-6 fill-white/90 text-white/90 drop-shadow-md" />
                    </span>
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={img.id}
                    src={img.thumbUrl}
                    alt={img.filename}
                    loading="lazy"
                    className="aspect-square w-full cursor-pointer rounded-md bg-muted object-cover"
                    onClick={() => onPreview({ images: post.images, index: i })}
                  />
                )
              )}
            </div>
          )}

          <p className="mt-2 text-xs text-muted-foreground" suppressHydrationWarning>
            {formatPostDate(post.createdAt)}
          </p>
        </div>
      </div>
    </article>
  );
}
