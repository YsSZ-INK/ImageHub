import { z } from "zod";
import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { respondAccess } from "@/server/access.service";

export const runtime = "nodejs";

const schema = z.object({ action: z.enum(["approve", "reject", "revoke"]) });

// 审批申请（同意/拒绝）或撤销已授权（仅图片主人可操作）
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const { action } = schema.parse(await req.json());
  return ok(await respondAccess(viewer, id, action));
});
