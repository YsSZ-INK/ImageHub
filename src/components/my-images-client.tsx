"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, FolderPlus, Eye, Trash2, X, Link2, UploadCloud, ChevronDown, ZoomIn, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import { Lightbox } from "@/components/lightbox";
import { Pager } from "@/components/pager";
import { UploadDropzone } from "@/components/upload-dropzone";
import { VisibilityBadge } from "@/components/image-actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useCursorPager } from "@/lib/use-cursor-pager";

// 我的图片：多选 + 批量操作（删除/移动相册/改可见性）
export function MyImagesClient({ albums }: { albums: { id: string; name: string }[] }) {
  const router = useRouter();
  // 游标分页：翻页/跳页逻辑统一在 hook 内
  const { items, page, hasNext, loading, loadPage, gotoPage } = useCursorPager({ scope: "mine" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [dialog, setDialog] = useState<"album" | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [albumId, setAlbumId] = useState("");
  // 灯箱预览：当前页内索引
  const [preview, setPreview] = useState<number | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBatch(action: string, extra?: Record<string, unknown>) {
    if (selected.size === 0) return;
    setBatching(true);
    try {
      const res = await fetch("/api/images/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, ...extra }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`已处理 ${json.data.affected} 张图片`);
        setSelected(new Set());
        setDialog(null);
        router.refresh();
        loadPage(page);
      } else toast.error(json.error);
    } finally {
      setBatching(false);
    }
  }

  async function batchDelete() {
    if (!confirm(`确定把选中的 ${selected.size} 张图片移入回收站？`)) return;
    await runBatch("delete");
  }

  // 复制图片外链（原图直链；PUBLIC/UNLISTED 免登录可访问）
  async function copyLink(id: string) {
    const url = `${window.location.origin}/api/images/${id}/raw`;
    await navigator.clipboard.writeText(url);
    toast.success("外链已复制", { description: url });
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && !loading ? (
        <>
          {/* 上传入口：按钮弹出上传界面 */}
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="h-4 w-4" /> 上传图片 / 视频
            </Button>
          </div>
          <EmptyState title="还没有图片" description="去上传你的第一张图片吧" />
        </>
      ) : (
        <>
          {/* 工具栏：多选 + 批量操作 + 上传按钮 */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={items.length > 0 && items.every((i) => selected.has(i.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected(new Set([...selected, ...items.map((i) => i.id)]));
                    } else {
                      const next = new Set(selected);
                      items.forEach((i) => next.delete(i.id));
                      setSelected(next);
                    }
                  }}
                />
                全选本页
              </label>
              {/* 批量操作栏：常驻显示，未选中时禁用操作 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">已选 {selected.size} 张</span>
                <Button size="sm" variant="outline" className="text-sm" disabled={batching || selected.size === 0} onClick={() => setDialog("album")}>
                  <FolderPlus className="h-4 w-4" /> 移动相册
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="text-sm" disabled={batching || selected.size === 0}>
                      设置可见性 <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => runBatch("visibility", { visibility: "PUBLIC" })}>
                      公开（所有人可见）
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => runBatch("visibility", { visibility: "UNLISTED" })}>
                      有链可见（拿到链接即可看）
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => runBatch("visibility", { visibility: "PRIVATE" })}>
                      私有（仅自己 · 不提供外链）
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="destructive" className="text-sm" disabled={batching || selected.size === 0} onClick={batchDelete}>
                  <Trash2 className="h-4 w-4" /> 删除
                </Button>
                {selected.size > 0 && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="取消选择" onClick={() => setSelected(new Set())}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="h-4 w-4" /> 上传图片 / 视频
            </Button>
          </div>

          {/* 带复选框的网格 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
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
                      onClick={() => toggle(img.id)}
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
                    onClick={() => toggle(img.id)}
                  />
                )}
                {/* 正中放大按钮：点击放大查看，不触发选中 */}
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
                <label className="absolute left-2 top-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-current"
                    checked={selected.has(img.id)}
                    onChange={() => toggle(img.id)}
                  />
                </label>
                <div className="absolute bottom-2 right-2 z-10 transition-opacity group-hover:opacity-0">
                  <VisibilityBadge visibility={img.visibility} className="bg-transparent text-black ring-0" />
                </div>
                <button
                  type="button"
                  aria-label="复制外链"
                  title="复制外链"
                  className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyLink(img.id);
                  }}
                >
                  <Link2 className="h-3.5 w-3.5" />
                </button>
                <p className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent p-1.5 text-xs text-white opacity-0 group-hover:opacity-100">
                  {img.filename}
                </p>
                </div>
                {/* 链接条：每张图片常驻显示外链，点击复制完整地址 */}
              <button
                type="button"
                title={`点击复制外链：/api/images/${img.id}/raw`}
                className="flex w-full items-center gap-1.5 border-t bg-muted/50 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  copyLink(img.id);
                }}
              >
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="truncate">/api/images/{img.id}/raw</span>
              </button>
            </div>
          ))}
          </div>

          {/* 翻页：支持输入页码跳转 */}
          <Pager page={page} hasNext={hasNext} disabled={loading} onGo={gotoPage} />
        </>
      )}

      {/* 上传弹窗：整批结束后刷新列表 */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>上传图片</DialogTitle>
          </DialogHeader>
          <UploadDropzone albums={albums} onSettled={() => loadPage(1)} />
        </DialogContent>
      </Dialog>

      {/* 移动相册弹窗 */}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>移动到相册</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
              <option value="">选择相册…</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="none">移出相册（清空归属）</option>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                disabled={batching || !albumId}
                onClick={() => runBatch("album", { albumId: albumId === "none" ? null : albumId })}
              >
                {batching ? <Loader2 className="animate-spin" /> : null} 确定
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* 灯箱放大查看（当前页内可左右切换，ESC 关闭） */}
      {preview !== null && (
        <Lightbox images={items} index={preview} onClose={() => setPreview(null)} onNavigate={setPreview} />
      )}
    </div>
  );
}
