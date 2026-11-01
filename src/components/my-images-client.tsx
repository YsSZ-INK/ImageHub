"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, FolderPlus, Eye, Trash2, X, Link2, UploadCloud, ChevronDown, ZoomIn, Play, RotateCcw, Images, ImageOff, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import { Lightbox } from "@/components/lightbox";
import { Pager } from "@/components/pager";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useCursorPager } from "@/lib/use-cursor-pager";
import { formatBytes } from "@/lib/utils";
import { markerLabel, markerBadgeClass } from "@/lib/markers";
import type { ImageDTO } from "@/server/image.service";

// 复制文本到剪贴板（外链 / HTML / Markdown 共用）
async function copyText(text: string, tip = "已复制") {
  await navigator.clipboard.writeText(text);
  toast.success(tip, { description: text });
}

// 外链弹窗里的一行：只读输入框 + 复制按钮
function ShareField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="text-xs" />
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyText(value)}>
          <Copy className="h-4 w-4" /> 复制
        </Button>
      </div>
    </div>
  );
}

// 我的图片：多选 + 批量操作（删除/移动相册/改可见性）+ 按存储位置筛选
export function MyImagesClient({ albums, storages }: { albums: { id: string; name: string }[]; storages: { marker: string; label: string }[] }) {
  // 存储位置筛选：空 = 全部；切换后 useCursorPager 自动回第一页重新加载
  const [storage, setStorage] = useState("");
  // 游标分页：翻页/跳页逻辑统一在 hook 内
  const { items, page, hasNext, loading, loadPage, gotoPage, totalPages } = useCursorPager({
    scope: "mine",
    ...(storage ? { storage } : {}),
  });
  // 徽标文案：自定义槽位名优先（与筛选按钮一致），回退默认「R2 一/二/…」
  const labelOf = (m: string) => storages.find((s) => s.marker === m)?.label ?? markerLabel(m);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [dialog, setDialog] = useState<"album" | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [albumId, setAlbumId] = useState("");
  // 灯箱预览：当前页内索引
  const [preview, setPreview] = useState<number | null>(null);
  // 外链分享弹窗：展示加载好的原图 + 各格式复制
  const [shareFor, setShareFor] = useState<ImageDTO | null>(null);

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
        // 列表就地刷新（ajax）；侧栏存储卡片由 10 秒轮询更新，无需整页刷新
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

  // 重新审核：图片回到待审核队列，管理员通过前从画廊与公开外链中隐藏
  async function reReview(id: string) {
    if (!confirm("重新提交审核？审核通过前，该图片将从画廊与公开外链中隐藏。")) return;
    const res = await fetch(`/api/images/${id}/review`, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      toast.success("已提交重新审核");
      loadPage(page);
    } else toast.error(json.error);
  }

  // 跨页全选：拉取当前筛选下全部图片 id（含未加载页）
  async function selectAll() {
    try {
      const sp = new URLSearchParams();
      if (storage) sp.set("storage", storage);
      const res = await fetch(`/api/images/ids${sp.size ? `?${sp}` : ""}`);
      const json = await res.json();
      if (json.ok) {
        setSelected(new Set<string>(json.data.ids));
        toast.success(`已选中全部 ${json.data.ids.length} 张（含未加载页）`);
      } else toast.error(json.error);
    } catch {
      toast.error("网络错误，请稍后再试");
    }
  }

  // 进入/移出公共画廊：改为选中后点按钮批量操作（进入 = 设为公开，审核通过后进画廊）
  async function setGallery(toPublic: boolean) {
    if (selected.size === 0) return;
    await runBatch("visibility", { visibility: toPublic ? "PUBLIC" : "PRIVATE" });
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col space-y-4">
      {/* 存储位置筛选：全部 / 本地磁盘 / 各个存储桶（自定义名） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">位置：</span>
        <Button size="sm" variant={storage === "" ? "secondary" : "outline"} className="h-8" onClick={() => setStorage("")}>
          全部
        </Button>
        {storages.map((s) => (
          <Button
            key={s.marker}
            size="sm"
            variant={storage === s.marker ? "secondary" : "outline"}
            className="h-8"
            onClick={() => setStorage(s.marker)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      {items.length === 0 && !loading ? (
        <>
          {/* 上传入口：按钮弹出上传界面 */}
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="h-4 w-4" /> 上传图片 / 视频
            </Button>
          </div>
          <EmptyState title={storage ? `${labelOf(storage)}还没有图片` : "还没有图片"} description={storage ? "换个位置看看，或上传新图片" : "去上传你的第一张图片吧"} />
        </>
      ) : (
        <>
          {/* 工具栏：多选 + 批量操作 + 上传按钮 */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {/* 选中本页开关 + 已选计数合并为一个控件：勾选即选中本页，文字实时显示已选张数 */}
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
              <Button size="sm" variant="outline" className="text-sm" disabled={batching} onClick={selectAll} title="选中当前筛选下的所有图片（含未加载页）">
                全选
              </Button>
              <Button size="sm" variant="outline" className="text-sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())} title="清空当前选中">
                取消全选
              </Button>
              {/* 批量操作栏：常驻显示，未选中时禁用操作（已选计数见左侧勾选框） */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-sm"
                  disabled={batching || selected.size === 0}
                  onClick={() => setGallery(true)}
                  title="把选中图片设为公开（审核通过后进入公共画廊）"
                >
                  <Images className="h-4 w-4" /> 进入画廊
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-sm"
                  disabled={batching || selected.size === 0}
                  onClick={() => setGallery(false)}
                  title="把选中图片设为私有，从公共画廊移出"
                >
                  <ImageOff className="h-4 w-4" /> 移出画廊
                </Button>
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
                      友链（登录任意账户即可看）
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
                {/* 勾选按钮：未选中任何图片时 hover 才显示；本卡片已选中或页面有选中时常驻 */}
                <label
                  className={`absolute left-2 top-2 cursor-pointer transition-opacity ${
                    selected.has(img.id) || selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-current"
                    checked={selected.has(img.id)}
                    onChange={() => toggle(img.id)}
                  />
                </label>
                {/* 顶部操作：重新审核（仅已发布；复制外链走图片下方「外链」按钮的弹窗） */}
                <div className="absolute right-2 top-2 z-10 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {img.status === "PUBLISHED" && (
                    <button
                      type="button"
                      aria-label="重新审核"
                      title="重新审核：通过前将从画廊与外链隐藏"
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        reReview(img.id);
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent p-1.5 text-xs text-white opacity-0 group-hover:opacity-100">
                  {img.filename}
                </p>
                </div>
                {/* 图片下方信息条：五格均分铺满图片宽度（外链 / 存储位置 / 画廊 / 可见性 / 大小），统一胶囊样式 */}
              <div className="grid w-full grid-cols-5 gap-0.5 border-t bg-muted/50 px-1.5 py-1">
                <Button
                  variant="outline"
                  className="inline-flex h-4 w-full items-center justify-center rounded px-0.5 text-[0.625rem] leading-none"
                  title="外链分享：查看原图并复制链接 / 嵌入代码"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareFor(img);
                  }}
                >
                  <Link2 className="h-2.5 w-2.5" /> 外链
                </Button>
                <span
                  className={`inline-flex h-4 w-full items-center justify-center truncate rounded px-0.5 text-[0.625rem] leading-none font-medium ${markerBadgeClass(img.storage)}`}
                  title="存储位置"
                >
                  {labelOf(img.storage)}
                </span>
                {/* 画廊状态：已入画廊（公开且已过审）显示绿色，否则灰色 */}
                {img.status === "PUBLISHED" && img.visibility === "PUBLIC" ? (
                  <span
                    className="inline-flex h-4 w-full items-center justify-center rounded bg-green-500/15 px-0.5 text-[0.625rem] leading-none font-medium text-green-600"
                    title="已进入公共画廊"
                  >
                    画廊
                  </span>
                ) : (
                  <span
                    className="inline-flex h-4 w-full items-center justify-center rounded bg-muted px-0.5 text-[0.625rem] leading-none font-medium text-muted-foreground"
                    title={img.status === "PENDING" ? "审核通过后才能进入公共画廊" : "未进入公共画廊（选中后点「进入画廊」）"}
                  >
                    未入
                  </span>
                )}
                {/* 可见性（原图片右下角徽标移入信息条）：审核中优先显示，其余按可见性着色 */}
                {img.status === "PENDING" ? (
                  <span
                    className="inline-flex h-4 w-full items-center justify-center rounded bg-amber-500/15 px-0.5 text-[0.625rem] leading-none font-medium text-amber-600"
                    title="等待管理员审核"
                  >
                    审核中
                  </span>
                ) : img.visibility === "PUBLIC" ? (
                  <span
                    className="inline-flex h-4 w-full items-center justify-center rounded bg-blue-500/15 px-0.5 text-[0.625rem] leading-none font-medium text-blue-600"
                    title="公开（所有人可见）"
                  >
                    公开
                  </span>
                ) : img.visibility === "UNLISTED" ? (
                  <span
                    className="inline-flex h-4 w-full items-center justify-center rounded bg-purple-500/15 px-0.5 text-[0.625rem] leading-none font-medium text-purple-600"
                    title="友链（登录任意账户即可访问，不进入公共画廊）"
                  >
                    友链
                  </span>
                ) : (
                  <span
                    className="inline-flex h-4 w-full items-center justify-center rounded bg-orange-500/15 px-0.5 text-[0.625rem] leading-none font-medium text-orange-600"
                    title="私有（仅自己可见）"
                  >
                    私有
                  </span>
                )}
                {/* 文件大小：与其他格相同的方块胶囊样式 */}
                <span
                  className="inline-flex h-4 w-full items-center justify-center rounded bg-muted px-0.5 text-[0.625rem] leading-none tabular-nums text-muted-foreground"
                  title="文件大小"
                >
                  {formatBytes(img.size)}
                </span>
              </div>
            </div>
          ))}
          </div>

          {/* 翻页：贴底显示（支持输入页码跳转，显示总页数） */}
          <div className="mt-auto">
            <Pager page={page} hasNext={hasNext} totalPages={totalPages} disabled={loading} onGo={gotoPage} />
          </div>
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
      {/* 外链分享弹窗：加载好的原图 + 直接链接 / 嵌入 HTML / Markdown 一键复制 */}
      {/* onOpenAutoFocus 阻止弹窗自动聚焦第一个输入框（否则直接链接一打开就带焦点高亮，像被选中） */}
      <Dialog open={!!shareFor} onOpenChange={(o) => !o && setShareFor(null)}>
        <DialogContent className="max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>外链分享</DialogTitle>
          </DialogHeader>
          {shareFor && (() => {
            const abs = `${window.location.origin}/api/images/${shareFor.id}/raw`;
            const hint =
              shareFor.visibility === "PUBLIC" && shareFor.status === "PUBLISHED"
                ? "该图片已公开：任何人拿到链接即可访问。"
                : shareFor.visibility === "UNLISTED" && shareFor.status === "PUBLISHED"
                  ? "该图片「友链」：登录任意账户后即可访问，未登录访客无法打开，不进入公共画廊。"
                  : "该图片尚未公开（私有或审核中）：外链目前仅自己与管理员可访问，设为公开后对其他人生效。";
            return (
              <div className="space-y-4">
                <div className="flex max-h-80 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                  {shareFor.kind === "video" ? (
                    <video src={shareFor.rawUrl} controls playsInline className="max-h-80 w-full bg-black/90" />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={shareFor.rawUrl} alt={shareFor.filename} className="max-h-80 w-full object-contain" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{hint}</p>
                <ShareField label="直接链接" value={abs} />
                <ShareField label="嵌入 HTML" value={`<img src="${abs}" alt="${shareFor.filename}" />`} />
                <ShareField label="Markdown" value={`![${shareFor.filename}](${abs})`} />
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      {/* 灯箱放大查看（当前页内可左右切换，ESC 关闭） */}
      {preview !== null && (
        <Lightbox images={items} index={preview} onClose={() => setPreview(null)} onNavigate={setPreview} />
      )}
    </div>
  );
}
