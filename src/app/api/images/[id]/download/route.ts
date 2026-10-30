import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorageFor } from "@/lib/storage";

export const runtime = "nodejs";

// 受保护下载：未登录 401；带 attachment 头
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });

  const { id } = await params;
  const img = await getImageForView(id, viewer);
  let buf: Buffer;
  try {
    buf = await (await getStorageFor(img.storage)).get(img.storageKey);
  } catch {
    throw new AppError("文件缺失", 404);
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": img.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(img.filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
});
