"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Play, Search, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/date-field";
import { EmptyState } from "@/components/image-grid";
import { Lightbox } from "@/components/lightbox";
import { Pager } from "@/components/pager";
import { useCursorPager } from "@/lib/use-cursor-pager";
import { shortDate } from "@/lib/utils";
import type { ImageDTO } from "@/server/image.service";

// 日常记录（虚拟相册）：自动汇总所有上传的照片，每张照片带「@上传者 · 时间」标签。
// 管理员看全站照片，普通用户看自己的；照片不搬家，仍保留在各自相册中。
// 支持筛选：按上传者用户名（管理员）+ 上传时间范围，可组合、可单独使用。
export function DailyAlbumClient({ isAdmin }: { isAdmin: boolean }) {
  // 筛选条件：上传者用户名（仅管理员）+ 起止日期；变更后 useCursorPager 自动回第一页
  const [owner, setOwner] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { items, page, hasNext, totalPages, loading, loadPage, gotoPage, total } = useCursorPager({
    scope: isAdmin ? "admin" : "mine",
    ...(owner ? { owner } : {}),
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
  });
  const [preview, setPreview] = useState<number | null>(null);
  const hasFilter = owner || from || to;

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
            {isAdmin
              ? "自动汇总所有人上传的照片，每张照片都带上传者标签"
              : "自动汇总你上传的照片，每张照片都带上传者标签"}
            {total != null ? ` · 共 ${total} 张` : ""}
          </p>
        </div>
      </div>

      {/* 筛选栏：按上传者 + 时间范围，可组合也可单独使用 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        {isAdmin && (
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="按上传者用户名筛选"
            className="h-9 w-44 text-sm"
          />
        )}
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
          description={hasFilter ? "换个筛选条件试试" : isAdmin ? "等大家上传照片后自动出现在这里" : "去上传你的第一张照片吧"}
        />
      ) : (
        <>
          {/* 网格：每张卡片常驻显示上传者标签（需求核心） */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
            {items.map((img, idx) => (
              <div key={img.id} className="group overflow-hidden rounded-lg border border-border">
                <div className="relative">
                  {img.kind === "video" ? (
                    <>
                      <video
                        src={img.rawUrl}
                        preload="metadata"
                        muted
                        playsInline
                        className="aspect-square w-full cursor-pointer bg-muted object-cover"
                        onClick={() => setPreview(idx)}
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <Play className="h-7 w-7 fill-white/90 text-white/90 drop-shadow-md" />
                      </span>
                    </>
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
                  {/* 正中放大按钮：点击放大查看 */}
                  <button
                    type="button"
                    aria-label="放大查看"
                    title="放大查看"
                    className="absolute inset-0 m-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreview(idx);
                    }}
                  >
                    <ZoomIn className="h-5 w-5" />
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
