import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorageFor } from "@/lib/storage";
import { getThumb } from "@/lib/thumb-cache";
import sharp from "sharp";

export const runtime = "nodejs";

// 缩略图访问：PUBLIC / UNLISTED 免登录直链，PRIVATE 仅本人/管理员（权限校验防 IDOR）
// 缩略图不作为对象存进存储桶：统一由原图现场生成 400px（?w=2560 为灯箱预览档），
// 结果进本地两级缓存（内存 LRU + storage/.thumbs/ 磁盘），命中后零回源零生成；缓存一天自动清空重建
// 视频没有缩略图：重定向到原文件，由前端 <video preload="metadata"> 展示首帧
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await getCurrentUser();
  const { id } = await params;
  const img = await getImageForView(id, viewer);
  if (img.mimeType.startsWith("video/")) {
    return NextResponse.redirect(new URL(`/api/images/${id}/raw`, req.url), 307);
  }
  const preview = new URL(req.url).searchParams.get("w") === "2560";
  let buf: Buffer;
  try {
    const cacheKey = preview ? `${img.storage}:${img.storageKey}:2560` : `${img.storage}:${img.storageKey}:gen400`;
    buf = await getThumb(cacheKey, async () => {
      const storage = await getStorageFor(img.storage);
      if (preview) {
        // 预览档：回源原图缩到 2560px（大屏放大后仍接近原图观感；GIF 动图直接回原图，避免丢动画）
        if (img.mimeType === "image/gif") return storage.get(img.storageKey);
        const raw = await storage.get(img.storageKey);
        return sharp(raw).resize({ width: 2560, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      }
      const raw = await storage.get(img.storageKey);
      return sharp(raw).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    });
  } catch {
    throw new AppError("文件缺失", 404);
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": `${viewer ? "private" : "public"}, max-age=86400, stale-while-revalidate=86400`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

