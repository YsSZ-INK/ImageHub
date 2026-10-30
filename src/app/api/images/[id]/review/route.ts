import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { requestReview } from "@/server/image.service";

export const runtime = "nodejs";

// 重新审核：图片回到待审核状态（从画廊 / 公开直链 / 动态中隐藏，等待管理员重新审核）
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  return ok(await requestReview(id, viewer));
});
