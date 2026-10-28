import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * 受保护的图片原图访问：
 * - 未登录 → 401（无匿名直链、无签名 URL）
 * - 校验归属/可见性（防 IDOR）
 * - 响应不暴露存储 key
 */
async function serveImage(id: string, kind: "raw" | "thumb", download = false) {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });

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
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(img.filename)}`;
  }
  return new NextResponse(new Uint8Array(buf), { headers });
}

export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return serveImage(id, "raw", new URL(req.url).searchParams.get("download") === "1");
});
