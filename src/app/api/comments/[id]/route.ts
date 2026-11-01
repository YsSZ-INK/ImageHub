import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { deleteComment } from "@/server/post.service";

export const runtime = "nodejs";

// 删除评论（仅本人或管理员）
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  await deleteComment(id, viewer);
  return ok({ message: "评论已删除" });
});
