import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { requestAccess } from "@/server/access.service";

export const runtime = "nodejs";

// 向某个用户发起「查看图片」申请
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  return ok(await requestAccess(viewer, id));
});
