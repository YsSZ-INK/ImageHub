"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, FolderMinus, FolderPlus, Trash2, X, Pencil, Image as ImageIcon, ChevronLeft, ChevronDown, Images, ImageOff, Play, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { AlbumFormDialog } from "@/components/album-form-dialog";
import { EmptyState } from "@/components/image-grid";
import { VisibilityBadge } from "@/components/image-actions";
import { Lightbox } from "@/components/lightbox";
import { Pager } from "@/components/pager";
import { useCursorPager } from "@/lib/use-cursor-pager";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { shortDate, videoCoverSrc } from "@/lib/utils";
import type { ImageDTO } from "@/server/image.service";

type AlbumInfo = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  coverImageId: string | null;
  imageCount: number;
  ownerName?: string;
};

// 相册详情（拥有者）：批量移出相册/设为封面/进入或移出画廊/改可见性/移动相册/删除 + 编辑相册
export function AlbumDetailClient({
  album: initialAlbum,
  initialItems,
  initialCursor,
  showUploader,
}: {
  album: AlbumInfo;
  initialItems: ImageDTO[];
  initialCursor: string | null;
  showUploader?: boolean;
}) {
  const [album, setAlbum] = useState(initialAlbum);
  // 与「我的图片」一致：游标翻页（上一页/下一页/跳页），首屏用服务端已渲染的数据
  const { items, page, hasNext, loading, loadPage, gotoPage, totalPages } = useCursorPager(
    { scope: "album", albumId: album.id },
    { initialItems, initialCursor }
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  // 灯箱预览：当前页内索引
  const [preview, setPreview] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // 移动相册弹窗：目标相册列表懒加载（排除当前相册）
  const [moveOpen, setMoveOpen] = useState(false);
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([]);
  const [targetAlbum, setTargetAlbum] = useState("");

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
        // 就地刷新当前页（ajax），不整页 reload
        loadPage(page);
      } else toast.error(json.error);
    } finally {
      setBatching(false);
    }
  }

  async function batchRemove() {
    await runBatch("album", { albumId: null });
  }

  // 进入/移出公共画廊（进入 = 设为公开，审核通过后进画廊）
  async function setGallery(toPublic: boolean) {
    await runBatch("visibility", { visibility: toPublic ? "PUBLIC" : "PRIVATE" });
  }

  // 打开移动相册弹窗时拉取相册列表（排除当前相册）
  async function openMove() {
    setTargetAlbum("");
    setMoveOpen(true);
    try {
      const res = await fetch("/api/albums");
      const json = await res.json();
      if (json.ok) setAlbums((json.data as { id: string; name: string }[]).filter((a) => a.id !== album.id));
    } catch {
      // 打开失败也能手动取消
    }
  }

  async function moveToAlbum() {
    if (!targetAlbum) return;
    await runBatch("album", { albumId: targetAlbum });
    setMoveOpen(false);
  }

  async function removeOne(imgId: string) {
    setBatching(true);
    try {
      const res = await fetch("/api/images/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [imgId], action: "album", albumId: null }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已移出相册");
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

  async function setCover(imgId: string) {
    if (imgId === album.coverImageId) return;
    setBatching(true);
    try {
      const res = await fetch(`/api/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverImageId: imgId }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已设为封面");
        setAlbum((a) => ({ ...a, coverImageId: imgId }));
      } else toast.error(json.error);
    } finally {
      setBatching(false);
    }
  }

  const coverId = album.coverImageId;

  return (
    <div className="space-y-4">
      {/* 相册头部：信息 + 编辑 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Button asChild variant="outline" className="mb-2">
            <Link href="/albums">
              <ChevronLeft className="h-4 w-4" /> 返回相册管理
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            {album.name}
            <VisibilityBadge visibility={album.visibility} />
          </h1>
          {album.ownerName && <p className="mt-0.5 text-xs text-muted-foreground">来自用户：{album.ownerName}</p>}
          {album.description && <p className="mt-1 text-sm text-muted-foreground">{album.description}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">共 {album.imageCount} 张图片</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" /> 编辑相册
        </Button>
      </div>

      {items.length === 0 && !loading ? (
        <EmptyState title="相册里还没有图片" description="在「我的图片」中批量选择图片并移动到该相册" />
      ) : (
        <>
          {/* 批量操作栏：常驻显示，未选中时禁用操作 */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {/* 选中本页开关 + 已选计数合并为一个控件（与「我的图片」一致） */}
            <label className="flex cursor-pointer items-center gap-2" title="勾选选中本页全部图片，取消勾选清除本页选中">
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
              <span className="text-sm text-muted-foreground">已选 {selected.size} 张</span>
            </label>
            <Button size="sm" variant="outline" className="text-sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())} title="清空当前选中">
              取消全选
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={batching || selected.size === 0} onClick={batchRemove}>
                <FolderMinus className="h-4 w-4" /> 移出相册
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batching || selected.size === 0}
                onClick={() => setGallery(true)}
                title="把选中图片设为公开（审核通过后进入公共画廊）"
              >
                <Images className="h-4 w-4" /> 进入画廊
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batching || selected.size === 0}
                onClick={() => setGallery(false)}
                title="把选中图片设为私有，从公共画廊移出"
              >
                <ImageOff className="h-4 w-4" /> 移出画廊
              </Button>
              <Button size="sm" variant="outline" disabled={batching || selected.size === 0} onClick={openMove}>
                <FolderPlus className="h-4 w-4" /> 移动相册
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batching || selected.size === 0}>
                    设置可见性 <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => runBatch("visibility", { visibility: "PUBLIC" })}>
                    公开（所有人可见）
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runBatch("visibility", { visibility: "UNLISTED" })}>
                    友链（登录任意账户即可看）
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runBatch("visibility", { visibility: "PRIVATE" })}>
                    私有（仅自己 · 不提供外链）
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" disabled={batching || selected.size !== 1} onClick={() => setCover([...selected][0])}>
                <ImageIcon className="h-4 w-4" /> 设为封面
              </Button>
              <Button size="sm" variant="destructive" disabled={batching || selected.size === 0} onClick={batchDelete}>
                <Trash2 className="h-4 w-4" /> 删除
              </Button>
              {selected.size > 0 && (
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="取消选择" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* 小字提醒：点图中央是放大细观（灯箱），点图其余处是选中 */}
          <p className="text-xs text-muted-foreground">轻点图片中央，细观全貌；点其四周，即为选中</p>

          {/* 带复选框的网格：视频用 <video> 取首帧并常驻播放键，图片走缩略图 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((img, idx) => (
              <div key={img.id} className="group relative overflow-hidden rounded-lg border border-border">
                {img.kind === "video" ? (
                  // 视频没有缩略图：直接播首帧，点击卡片其余区域仍是选中
                  <video
                    src={videoCoverSrc(img.rawUrl)}
                    preload="metadata"
                    muted
                    playsInline
                    className="aspect-square w-full cursor-pointer bg-muted object-cover"
                    onClick={() => toggle(img.id)}
                  />
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
                {/* 正中按钮：视频为常驻播放键（不随鼠标现隐），图片为 hover 放大键；点击进灯箱，不触发选中 */}
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
                {/* 勾选按钮：未选中任何图片时 hover 才显示；本卡片已选中或页面有选中时常驻 */}
                <label
                  className={`absolute left-2 top-2 cursor-pointer transition-opacity ${
                    selected.has(img.id) || selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <input type="checkbox" className="h-4 w-4 accent-current" checked={selected.has(img.id)} onChange={() => toggle(img.id)} />
                </label>
                {img.id === coverId && (
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                    <ImageIcon className="h-3 w-3" /> 封面
                  </span>
                )}
                {/* hover 操作：设为封面 / 移出相册 */}
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {img.id !== coverId && (
                    <button
                      type="button"
                      aria-label="设为封面"
                      title="设为封面"
                      disabled={batching}
                      className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 disabled:opacity-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCover(img.id);
                      }}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="移出相册"
                    title="移出相册"
                    disabled={batching}
                    className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOne(img.id);
                    }}
                  >
                    <FolderMinus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="truncate">{img.filename}</p>
                  {/* 上传者与时间：管理员查看他人相册（如「日常记录」）时显示图片来源 */}
                  {showUploader && (
                    <p className="truncate text-[0.65rem] text-white/80">
                      上传者 {img.ownerName ?? "未知"} · {shortDate(img.createdAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 翻页：与「我的图片」一致的游标分页（上一页 / 下一页 / 输入页码跳转） */}
          <div className="mt-auto">
            <Pager page={page} hasNext={hasNext} totalPages={totalPages} disabled={loading} onGo={gotoPage} />
          </div>
        </>
      )}

      {/* 灯箱放大查看（当前页内可左右切换，ESC 关闭；相册内不提供旋转） */}
      {preview !== null && (
        <Lightbox images={items} index={preview} onClose={() => setPreview(null)} onNavigate={setPreview} />
      )}

      {/* 移动相册弹窗：把选中图片移到另一个相册 */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>移动到相册</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={targetAlbum} onChange={(e) => setTargetAlbum(e.target.value)}>
              <option value="">选择相册…</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMoveOpen(false)}>
                取消
              </Button>
              <Button disabled={batching || !targetAlbum} onClick={moveToAlbum}>
                {batching ? <Loader2 className="animate-spin" /> : null} 确定
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlbumFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        album={{ id: album.id, name: album.name, description: album.description, visibility: album.visibility }}
        onSaved={async () => {
          // 编辑后从相册列表回读，头部名称/描述/可见性立即生效
          try {
            const res = await fetch("/api/albums");
            const json = await res.json();
            if (json.ok) {
              const updated = (json.data as { id: string; name: string; description: string | null; visibility: string; imageCount: number }[]).find(
                (a) => a.id === album.id
              );
              if (updated) setAlbum((a) => ({ ...a, name: updated.name, description: updated.description, visibility: updated.visibility }));
            }
          } catch {
            // 忽略：下次进入页面会刷新
          }
        }}
      />
    </div>
  );
}
