import { NextResponse } from "next/server";
import { handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { getSettings, envMaxUploadMB } from "@/lib/settings";
import { initChunkUpload } from "@/server/chunk-upload.service";
import { assertAlbumAccess } from "@/server/image.service";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(100).default(""),
  totalChunks: z.number().int().positive(),
  albumId: z.string().max(64).optional().nullable(),
});

// 分片上传第一步：创建会话，返回 uploadId（大小上限与普通上传一致）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const rl = await rateLimit(`upload:${user.id}`, 60, 60_000);
  if (!rl.success) throw new AppError("上传过于频繁，请稍后再试", 429);

  const body = schema.parse(await req.json());
  await assertAlbumAccess(user, body.albumId ?? null);

  const settings = await getSettings();
  const maxMB = Math.min(settings.maxUploadMB, envMaxUploadMB() || settings.maxUploadMB);
  const data = await initChunkUpload(
    user,
    { filename: body.filename, size: body.size, mimeType: body.mimeType, totalChunks: body.totalChunks, albumId: body.albumId ?? null },
    maxMB * 1024 * 1024
  );
  return NextResponse.json({ ok: true, data }, { status: 201 });
});
