import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

// 受保护的缩略图访问（未登录 401，权限校验防 IDOR）
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });

  const { id } = await params;
  const img = await getImageForView(id, viewer);
  let buf: Buffer;
  try {
    buf = await (await getStorage()).get(img.thumbKey);
  } catch {
    throw new AppError("文件缺失", 404);
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
