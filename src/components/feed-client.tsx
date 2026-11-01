"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ImagePlus, Send, Trash2, ChevronDown, Play, CalendarDays, MessageCircle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { DateField } from "@/components/date-field";
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
  commentCount: number;
};

type FeedComment = {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string; avatarUrl: string | null };
  canDelete: boolean;
  // 回复：parentId 指向所属顶层评论；replyTo 为被回复人（展示「回复 @某人」）
  parentId: string | null;
  replyTo: { id: string; name: string } | null;
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
  const fmtLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // 时间筛选（YYYY-MM-DD）：默认不筛选 = 显示全部动态（按发布时间新→旧从上往下排列）
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<string | null>(null);
  // 快捷时间区间：一键选定，免去手动输入日期；再点一次取消
  const PRESETS: { label: string; days: number }[] = [
    { label: "今天", days: 0 },
    { label: "昨天", days: 1 },
    { label: "近7天", days: 7 },
    { label: "近30天", days: 30 },
  ];
  function applyPreset(p: { label: string; days: number }) {
    if (preset === p.label) { setFrom(""); setTo(""); setPreset(null); return; }
    const today = new Date();
    if (p.days === 1) {
      // 昨天：单日
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const d = fmtLocal(y); setFrom(d); setTo(d);
    } else {
      // 今天 / 近N天（含今天）
      const fromD = new Date(today);
      if (p.days > 0) fromD.setDate(fromD.getDate() - (p.days - 1));
      setFrom(fmtLocal(fromD)); setTo(fmtLocal(today));
    }
    setPreset(p.label);
  }
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
        // 非法日期值直接忽略该筛选条件，避免客户端抛异常或发出无效请求
        if (f && !isNaN(new Date(`${f}T00:00:00`).getTime())) p.set("from", new Date(`${f}T00:00:00`).toISOString());
        if (t && !isNaN(new Date(`${t}T23:59:59.999`).getTime())) p.set("to", new Date(`${t}T23:59:59.999`).toISOString());
        const qs = p.toString();
        const res = await fetch(`/api/posts${qs ? `?${qs}` : ""}`);
        const json = await res.json();
        if (json.ok) {
          setItems((prev) => (c ? [...prev, ...json.data.items] : json.data.items));
          setCursor(json.data.nextCursor);
          setHasMore(Boolean(json.data.nextCursor));
        } else toast.error(json.error);
      } catch {
        toast.error("加载动态失败，请重试");
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
    if (!confirm(`删除这条动态？动态里的图片将一并移入回收站。`)) return;
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

      {/* 时间筛选：快捷区间一键选择，日期框仅用于自定义范围（大号控件，逐段输入） */}
      <div className="rounded-xl border border-foreground/10 bg-background/55 p-4 backdrop-blur-md">
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="mr-1 h-5 w-5 text-muted-foreground" />
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`h-9 rounded-full border px-4 text-sm transition-colors ${
                  preset === p.label
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
            {(from || to) && (
              <Button variant="ghost" size="sm" className="h-9 px-3 text-sm" onClick={() => { setFrom(""); setTo(""); setPreset(null); }}>
                清除
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DateField value={from} onChange={(v) => { setFrom(v); setPreset(null); }} />
            <span className="text-base text-muted-foreground">至</span>
            <DateField value={to} onChange={(v) => { setTo(v); setPreset(null); }} />
          </div>
        </div>
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

function Composer({
  me,
  onPublished,
}: {
  me: { name: string; avatarUrl: string | null };
  onPublished: () => void;
}) {
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
    if (picked.length === 0 && !caption.trim()) return;
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
            placeholder="分享照片或写点什么…"
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
            <div className="flex items-center gap-2">
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
            </div>
            <Button size="sm" disabled={publishing || (picked.length === 0 && !caption.trim())} onClick={publish}>
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
  const [commentCount, setCommentCount] = useState(post.commentCount);
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

          {n === 0 ? null : n === 1 ? (
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

          <div className="mt-2 flex items-center gap-3">
            <p className="text-xs text-muted-foreground" suppressHydrationWarning>
              {formatPostDate(post.createdAt)}
            </p>
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              {commentCount > 0 ? `${commentCount} 条评论` : "评论"}
            </span>
          </div>
          {/* 评论区常驻展开：默认显示 3 条，更多走「加载更多评论」 */}
          <PostComments post={post} onChange={setCommentCount} />
        </div>
      </div>
    </article>
  );
}

// ============ 评论区：顶层评论默认展开 3 条，回复缩进挂在其下，可回复任意评论 ============
const COMMENTS_VISIBLE = 3;

function PostComments({ post, onChange }: { post: FeedPost; onChange: (n: number) => void }) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // 回复目标：点「回复」后锁定，输入框显示「回复 @某人」，可取消
  const [replyTarget, setReplyTarget] = useState<FeedComment | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/posts/${post.id}/comments`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json.ok) {
          setComments(json.data);
          onChange(json.data.length);
        } else toast.error(json.error);
      })
      .catch(() => alive && toast.error("评论加载失败"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, ...(replyTarget ? { parentId: replyTarget.id } : {}) }),
      });
      const json = await res.json();
      if (json.ok) {
        setComments((prev) => [...(prev ?? []), json.data]);
        setDraft("");
        setReplyTarget(null);
        onChange((comments?.length ?? 0) + 1);
      } else toast.error(json.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: FeedComment) {
    if (!confirm(c.parentId === null ? "删除这条评论？其下回复将一并删除。" : "删除这条回复？")) return;
    setRemoving(c.id);
    try {
      const res = await fetch(`/api/comments/${c.id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        // 顶层评论删除时，其下回复随服务端级联删除，本地一并移除
        setComments((prev) => (prev ?? []).filter((x) => x.id !== c.id && x.parentId !== c.id));
        setReplyTarget((t) => (t && (t.id === c.id || t.parentId === c.id) ? null : t));
        const remain = (comments ?? []).filter((x) => x.id !== c.id && x.parentId !== c.id).length;
        onChange(Math.max(0, remain));
      } else toast.error(json.error);
    } finally {
      setRemoving(null);
    }
  }

  if (comments === null) {
    return (
      <div className="mt-3 flex justify-center rounded-lg bg-muted/40 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 分组：顶层评论 + 挂在其下的回复（一层线程）
  const tops = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);
  const visibleTops = showAll ? tops : tops.slice(0, COMMENTS_VISIBLE);

  const renderComment = (c: FeedComment, isReply: boolean) => (
    <li key={c.id} className="flex gap-2">
      <AvatarFallbackIcon name={c.user.name} url={c.user.avatarUrl} size={isReply ? 24 : 28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium">{c.user.name}</span>
          <span className="shrink-0 text-[0.65rem] text-muted-foreground" suppressHydrationWarning>
            {formatPostDate(c.createdAt)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {/* 回复按钮：任何评论/回复都可回复 */}
            <button
              type="button"
              className="text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setReplyTarget(c)}
            >
              回复
            </button>
            {c.canDelete && (
              <button
                type="button"
                aria-label="删除评论"
                title={c.user.id === post.author.id ? "删除评论" : "删除评论（管理员）"}
                disabled={removing === c.id}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                onClick={() => remove(c)}
              >
                {removing === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </button>
            )}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
          {c.replyTo && (
            <span className="mr-1 text-xs text-muted-foreground">
              回复 <span className="font-medium text-foreground/80">@{c.replyTo.name}</span>
            </span>
          )}
          {c.content}
        </p>
      </div>
    </li>
  );

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3">
      {comments.length === 0 ? (
        <p className="py-1 text-center text-xs text-muted-foreground">还没有评论</p>
      ) : (
        <>
          <ul className="space-y-2">
            {visibleTops.map((top) => {
              const replies = repliesOf(top.id);
              return (
                <li key={top.id} className="space-y-2">
                  {renderComment(top, false)}
                  {/* 回复缩进显示在顶层评论之下 */}
                  {replies.length > 0 && <ul className="ml-9 space-y-2 border-l border-foreground/10 pl-3">{replies.map((r) => renderComment(r, true))}</ul>}
                </li>
              );
            })}
          </ul>
          {tops.length > COMMENTS_VISIBLE && !showAll && (
            <button
              type="button"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowAll(true)}
            >
              加载更多评论（还有 {tops.length - COMMENTS_VISIBLE} 条）
            </button>
          )}
        </>
      )}
      {/* 回复状态条 + 输入框：锁定回复对象时显示「回复 @某人」，可取消 */}
      <div className="pt-1">
        {replyTarget && (
          <div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <span>
              回复 <span className="font-medium text-foreground/80">@{replyTarget.user.name}</span>
            </span>
            <button
              type="button"
              aria-label="取消回复"
              title="取消回复"
              className="transition-colors hover:text-foreground"
              onClick={() => setReplyTarget(null)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={500}
            placeholder={replyTarget ? `回复 @${replyTarget.user.name}…` : "写评论…"}
            className="h-9 bg-background text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button size="sm" className="h-9" disabled={busy || !draft.trim()} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
