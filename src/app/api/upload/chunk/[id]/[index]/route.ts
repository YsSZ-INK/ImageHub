import { NextResponse } from "next/server";
import { handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { putChunk, CHUNK_SIZE } from "@/server/chunk-upload.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 收一片：raw 二进制 body（非 multipart，省内存省解析）；覆盖写幂等，支持重传/断点续传
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string; index: string }> }) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const rl = await rateLimit(`chunk:${user.id}`, 1200, 60_000);
  if (!rl.success) throw new AppError("上传过于频繁，请稍后再试", 429);

  const { id, index } = await params;
  const idx = Number(index);
  if (!Number.isInteger(idx)) throw new AppError("分片下标不合法", 400);

  // 先看声明长度，超大分片直接拒绝（避免无谓读进内存）
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > CHUNK_SIZE + 2048) throw new AppError("分片过大", 413);

  const buf = Buffer.from(await req.arrayBuffer());
  const data = await putChunk(user, id, idx, buf);
  return NextResponse.json({ ok: true, data });
});
