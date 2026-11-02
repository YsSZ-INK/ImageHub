import { NextResponse } from "next/server";
import { handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { completeChunkUpload } from "@/server/chunk-upload.service";
import { normalizeUploadVisibility } from "@/server/image.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 分片上传最后一步：校验齐全 → 流式合并算 sha256 → 按类型入库（图片流水线 / 视频流式直传）
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const rl = await rateLimit(`upload:${user.id}`, 60, 60_000);
  if (!rl.success) throw new AppError("操作过于频繁，请稍后再试", 429);

  const { id } = await params;
  // 可选 JSON body 携带可见性（默认私有；公开 = 进画廊候选）
  let visibility: unknown;
  try {
    visibility = (await req.json())?.visibility;
  } catch {
    visibility = undefined;
  }
  const dto = await completeChunkUpload(user, id, normalizeUploadVisibility(visibility));
  return NextResponse.json({ ok: true, data: dto }, { status: 201 });
});
