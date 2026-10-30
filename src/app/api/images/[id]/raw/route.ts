import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorage } from "@/lib/storage";

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
  const storage = await getStorage();
  const key = kind === "thumb" ? img.thumbKey : img.storageKey;
  let buf: Buffer;
  try {
    buf = await storage.get(key);
  } catch {
    throw new AppError("文件缺失", 404);
  }

  const headers: Record<string, string> = {
    "Content-Type": kind === "thumb" ? "image/webp" : img.mimeType,
    "Cache-Control": `${viewer ? "private" : "public"}, max-age=31536000, immutable`,
    "X-Content-Type-Options": "nosniff",
  };
  if (download && viewer) {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(img.filename)}`;
  }

  // Range 请求（仅原文件；缩略图恒为完整图片）
  const rangeHeader = kind === "raw" ? req.headers.get("range") : null;
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (match && (match[1] !== "" || match[2] !== "")) {
    const total = buf.length;
    let start: number;
    let end: number;
    if (match[1] === "") {
      // 后缀区间：bytes=-N 取末尾 N 字节
      const n = parseInt(match[2] || "0", 10);
      start = Math.max(0, total - n);
      end = total - 1;
    } else {
      start = parseInt(match[1], 10);
      end = match[2] === "" || parseInt(match[2], 10) >= total ? total - 1 : parseInt(match[2], 10);
    }
    if (start > end || start >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    const slice = buf.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(slice.length),
      },
    });
  }

  headers["Accept-Ranges"] = "bytes";
  return new NextResponse(new Uint8Array(buf), { headers });
}

export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return serveFile(req, id, "raw", new URL(req.url).searchParams.get("download") === "1");
});
