import { NextResponse } from "next/server";
import { handle, assertSameOrigin } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listReceivedChunks } from "@/server/chunk-upload.service";

export const runtime = "nodejs";

// 断点续传查询：返回已落盘的分片下标，前端只补缺片
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const { id } = await params;
  const data = await listReceivedChunks(user, id);
  return NextResponse.json({ ok: true, data });
});
