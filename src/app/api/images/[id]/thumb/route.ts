import { NextResponse } from "next/server";
import { handle, AppError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getImageForView } from "@/server/image.service";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

// 缩略图访问：PUBLIC / UNLISTED 免登录直链，PRIVATE 仅本人/管理员（权限校验防 IDOR）
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await getCurrentUser();
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
      "Cache-Control": `${viewer ? "private" : "public"}, max-age=31536000, immutable`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
