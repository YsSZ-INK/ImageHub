"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Play, Search, Upload, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/date-field";
import { EmptyState } from "@/components/image-grid";
import { Lightbox } from "@/components/lightbox";
import { Pager } from "@/components/pager";
import { useCursorPager } from "@/lib/use-cursor-pager";
import { shortDate, videoCoverSrc } from "@/lib/utils";

// 日常记录（虚拟相册，仅管理员可见）：自动汇总所有图文动态发布的照片，每张照片带「@上传者 · 时间」标记。
// 照片随发布移出原相册、统一归入这里；支持按上传者用户名 + 上传时间范围筛选，可组合、可单独使用。
export function DailyAlbumClient() {
  // 筛选条件：上传者用户名 + 起止日期；变更后 useCursorPager 自动回第一页
  const [owner, setOwner] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { items, page, hasNext, totalPages, loading, loadPage, gotoPage, total } = useCursorPager({
    scope: "admin",
    posted: "1",
    ...(owner ? { owner } : {}),
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
  });
  const [preview, setPreview] = useState<number | null>(null);
  const hasFilter = owner || from || to;

  // 直接上传到日常记录：文件按站点存储设置写入（对象存储即进桶），上传成功后自动发一条动态，
  // 图片随之公开并归入本相册（动态接口单条最多 9 张，超出自动分批）
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadToDaily(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    const ids: string[] = [];
    let failed = 0;
    try {
      for (const f of files) {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const json = await res.json().catch(() => null);
        const r = json?.data?.results?.[0];
        if (json?.ok && r && !r.error) ids.push(r.id);
        else failed++;
      }
      let posted = 0;
      for (let i = 0; i < ids.length; i += 9) {
        const batch = ids.slice(i, i + 9);
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption: "", imageIds: batch }),
        });
        const json = await res.json().catch(() => null);
        if (json?.ok) posted += batch.length;
      }
      if (posted > 0) {
        toast.success(`已上传 ${posted} 张到日常记录${failed ? `，${failed} 张失败` : ""}`);
        loadPage(1);
      } else if (failed > 0) toast.error("上传失败，请重试");
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 头部：返回按钮 + 标题说明 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Button asChild variant="outline" className="mb-2">
            <Link href="/albums">
              <ChevronLeft className="h-4 w-4" /> 返回相册管理
            </Link>
          </Button>
          <h1 className="text-xl font-bold">日常记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            自动汇总所有图文动态发布的照片，每张照片都带上传者标记
            {total != null ? ` · 共 ${total} 张` : ""}
          </p>
        </div>
        {/* 上传入口：照片按站点存储设置写入（配置了对象存储即进桶），并自动发布成动态归入本相册 */}
        <div className="flex items-center gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} title="上传的照片会按存储设置写入，并自动发布成动态归入日常记录">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} 上传照片
          </Button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={uploadToDaily} />
        </div>
      </div>

      {/* 筛选栏：按上传者 + 时间范围，可组合也可单独使用 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="按上传者用户名筛选"
          className="h-9 w-44 text-sm"
        />
        <DateField value={from} onChange={setFrom} />
        <span className="text-sm text-muted-foreground">至</span>
        <DateField value={to} onChange={setTo} />
        {hasFilter && (
          <Button variant="ghost" size="sm" className="h-9 text-sm" onClick={() => { setOwner(""); setFrom(""); setTo(""); }}>
            清除
          </Button>
        )}
      </div>

      {items.length === 0 && !loading ? (
        <EmptyState
          title={hasFilter ? "没有符合条件的照片" : "还没有照片"}
          description={hasFilter ? "换个筛选条件试试" : "等大家在图文动态里发布照片后自动出现在这里"}
        />
      ) : (
        <>
          {/* 网格：每张卡片常驻显示上传者标签（需求核心） */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
            {items.map((img, idx) => (
              <div key={img.id} className="group overflow-hidden rounded-lg border border-border">
                <div className="relative">
                  {img.kind === "video" ? (
                    <video
                      src={videoCoverSrc(img.rawUrl)}
                      preload="metadata"
                      muted
                      playsInline
                      className="aspect-square w-full cursor-pointer bg-muted object-cover"
                      onClick={() => setPreview(idx)}
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={img.thumbUrl}
                      alt={img.filename}
                      loading="lazy"
                      className="aspect-square w-full cursor-pointer bg-muted object-cover"
                      onClick={() => setPreview(idx)}
                    />
                  )}
                  {/* 正中按钮：视频为常驻播放键（不随鼠标出现消失），图片为 hover 放大键；点击进灯箱 */}
                  <button
                    type="button"
                    aria-label={img.kind === "video" ? "播放" : "放大查看"}
                    title={img.kind === "video" ? "播放" : "放大查看"}
                    className={`absolute inset-0 m-auto flex items-center justify-center rounded-full text-white hover:bg-black/80 ${
                      img.kind === "video"
                        ? "h-12 w-12 bg-black/50"
                        : "h-10 w-10 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreview(idx);
                    }}
                  >
                    {img.kind === "video" ? (
                      <Play className="h-6 w-6 fill-white/90 text-white/90 drop-shadow-md" />
                    ) : (
                      <ZoomIn className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {/* 上传者标签：常驻显示（谁上传的 + 时间），字体加大便于阅读 */}
                <div className="border-t bg-muted/50 px-2 py-1.5">
                  <p className="truncate text-sm font-medium text-foreground">@{img.ownerName ?? "未知"}</p>
                  <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {shortDate(img.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* 翻页：支持输入页码跳转 */}
          <Pager page={page} hasNext={hasNext} totalPages={totalPages} disabled={loading} onGo={gotoPage} />
        </>
      )}

      {/* 灯箱放大查看（当前页内可左右切换，ESC 关闭） */}
      {preview !== null && (
        <Lightbox images={items} index={preview} onClose={() => setPreview(null)} onNavigate={setPreview} />
      )}
    </div>
  );
}
