import { NextResponse } from "next/server";
import { handle, assertSameOrigin } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { abortChunkUpload } from "@/server/chunk-upload.service";

export const runtime = "nodejs";

// 放弃分片会话：删除分片目录与会话记录，立即释放磁盘
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const { id } = await params;
  const data = await abortChunkUpload(user, id);
  return NextResponse.json({ ok: true, data });
});
