import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView, getImageForPublicView, type PublicImageSnapshot } from "@/server/image.service";
import { getStorageFor } from "@/lib/storage";
import { getThumb, thumbKey, THUMB_WIDTHS, type ThumbFormat } from "@/lib/thumb-cache";
import sharp from "sharp";

export const runtime = "nodejs";

// 缩略图访问：PUBLIC 免登录直链（匿名走缓存快照免查库），UNLISTED（友链）登录任意账户可见，
// PRIVATE 仅本人/管理员（权限校验防 IDOR）
// 缩略图不作为对象存进存储桶：统一由原图现场生成，结果进本地两级缓存（内存 LRU + storage/.thumbs/），
// 命中后零回源零生成；缓存一天自动清空重建。
// 支持 ?w= 指定的四档宽度（400/800/1600/2560），并优先输出 AVIF（不支持时回退 WebP），
// 供 <img srcset> 使用；响应带 ETag，重复访问可 304。
// 视频没有缩略图：重定向到原文件，由前端 <video preload="metadata"> 展示首帧
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await getCurrentUser();
  const { id } = await params;
  // 匿名高频直链：公开图优先取缓存行快照（0 次查库）；未命中 / 非公开 / 登录用户走完整校验
  let img: PublicImageSnapshot | null = null;
  if (!viewer) img = await getImageForPublicView(id);
  if (!img) img = await getImageForView(id, viewer);
  if (img.mimeType.startsWith("video/")) {
    return NextResponse.redirect(new URL(`/api/images/${id}/raw`, req.url), 307);
  }
  // GIF 动图：sharp 转码会丢帧，直接回原图（浏览器按需缩放），保持原本的动效与正确的 Content-Type
  if (img.mimeType === "image/gif") {
    return NextResponse.redirect(new URL(`/api/images/${id}/raw`, req.url), 307);
  }

  // 宽度白名单：不在列表里一律按 400（历史默认），避免任意尺寸把缓存打爆
  const wRaw = Number(new URL(req.url).searchParams.get("w"));
  const width = (THUMB_WIDTHS as readonly number[]).includes(wRaw) ? wRaw : 400;

  // 格式协商：Accept 里带 image/avif 就出 AVIF，否则 WebP（老浏览器也能显示）
  const accept = req.headers.get("accept") ?? "";
  const fmt: ThumbFormat = /image\/avif/i.test(accept) ? "avif" : "webp";

  // 版本号参与 ETag：旋转等原位重写后 ETag 随之变化，配合 max-age 也不会拿到旧图
  const etag = `W/"${img.id}-${img.version}-${width}-${fmt}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  let buf: Buffer;
  try {
    buf = await getThumb(thumbKey(img.storage, img.storageKey, width, fmt), async () => {
      const storage = await getStorageFor(img.storage);
      const raw = await storage.get(img.storageKey);
      const base = sharp(raw).resize({ width, withoutEnlargement: true });
      return fmt === "avif"
        ? base.avif({ quality: width >= 1600 ? 62 : 55 }).toBuffer()
        : base.webp({ quality: width >= 1600 ? 82 : 78 }).toBuffer();
    });
  } catch {
    throw new AppError("文件缺失", 404);
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": fmt === "avif" ? "image/avif" : "image/webp",
      // 一级缓存 1 天 + 一周的 stale-while-revalidate：重复访问直接命中，过期后后台刷新
      "Cache-Control": `${viewer ? "private" : "public"}, max-age=86400, stale-while-revalidate=604800`,
      ETag: etag,
      // 同一 URL 会按 Accept 返回 avif/webp，必须声明，否则共享缓存会把格式串错
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
