import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorageFor } from "@/lib/storage";
import { getRawCached, RAW_CACHE_MAX_FILE } from "@/lib/raw-cache";

export const runtime = "nodejs";

/**
 * 原文件访问（图片原图 / 视频原片）：
 * - PUBLIC / UNLISTED：免登录直链（外链），响应可公开缓存
 * - PRIVATE：仅本人 / 管理员（未登录 401）
 * - 校验可见性（防 IDOR），响应不暴露存储 key
 * - 视频（<video> 拖动进度条）依赖 Range 请求：支持单区间 bytes=start-end，返回 206
 */
async function serveFile(req: Request, id: string, kind: "raw" | "thumb", download = false) {
  const viewer = await getCurrentUser();
  const img = await getImageForView(id, viewer);
  // 按记录的实际存放位置取文件（local / r2）
  const storage = await getStorageFor(img.storage);
  const key = kind === "thumb" ? img.thumbKey : img.storageKey;

  const headers: Record<string, string> = {
    "Content-Type": kind === "thumb" ? "image/webp" : img.mimeType,
    "Cache-Control": `${viewer ? "private" : "public"}, max-age=31536000, immutable`,
    "X-Content-Type-Options": "nosniff",
  };
  if (download && viewer) {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(img.filename)}`;
  }

  // 原文件一律先取总大小；视频/大文件走流式，避免整文件读进内存拖垮服务
  let total: number;
  try {
    total = await storage.getSize(key);
  } catch {
    throw new AppError("文件缺失", 404);
  }
  // 视频（任意大小，需 Range 拖动）与超过缓存上限的图片走流式；其余图片走磁盘缓存路径
  const isVideo = img.mimeType.startsWith("video/");
  const streamIfLarge = kind === "raw" && (isVideo || total > RAW_CACHE_MAX_FILE);

  // Range 请求（仅原文件；缩略图恒为完整图片）：流式返回 206，视频首帧/拖动进度条只传所需区间
  const rangeHeader = kind === "raw" ? req.headers.get("range") : null;
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (match && (match[1] !== "" || match[2] !== "")) {
    let start: number;
    let end: number;
    if (match[1] === "") {
      // 后缀区间：bytes=-N 取末尾 N 字节
      const n = parseInt(match[2] || "0", 10) || 0;
      start = Math.max(0, total - n);
      end = total - 1;
    } else {
      start = parseInt(match[1], 10);
      end = match[2] === "" || parseInt(match[2], 10) >= total ? total - 1 : parseInt(match[2], 10);
    }
    if (start > end || start >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    try {
      const { body, length } = await storage.getRange(key, start, end + 1);
      return new NextResponse(body, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(length),
        },
      });
    } catch {
      throw new AppError("文件缺失", 404);
    }
  }

  // 大文件无 Range 请求（如浏览器直接打开视频）：同样流式整发，内存占用恒定
  if (streamIfLarge) {
    try {
      const { body, length } = await storage.getRange(key, 0, total);
      return new NextResponse(body, {
        headers: { ...headers, "Accept-Ranges": "bytes", "Content-Length": String(length) },
      });
    } catch {
      throw new AppError("文件缺失", 404);
    }
  }

  // 小文件（图片为主）：整读返回；原图走磁盘 LRU 缓存——看过一次永久本地化，之后再访问免跨网回源
  let buf: Buffer;
  try {
    buf =
      kind === "raw" && !img.mimeType.startsWith("video/")
        ? await getRawCached(`${img.storage}:${key}`, () => storage.get(key))
        : await storage.get(key);
  } catch {
    throw new AppError("文件缺失", 404);
  }
  headers["Accept-Ranges"] = "bytes";
  return new NextResponse(new Uint8Array(buf), { headers });
}

export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return serveFile(req, id, "raw", new URL(req.url).searchParams.get("download") === "1");
});
