import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { deletePost } from "@/server/post.service";

export const runtime = "nodejs";

// 删除动态（作者本人或管理员；图片保留在相册中）
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  await deletePost(id, viewer);
  return ok({ message: "动态已删除" });
});
