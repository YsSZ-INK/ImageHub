import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listComments, addComment } from "@/server/post.service";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  content: z.string().max(500).trim(),
  // 回复目标：被回复评论的 id（可选；服务端校验归属并归并到顶层线程）
  parentId: z.string().min(1).optional(),
});

// 评论列表（时间正序，含回复；canDelete：本人或管理员）
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await requireApiUser();
  const { id } = await params;
  return ok(await listComments(id, viewer));
});

// 发表评论 / 回复（登录用户）
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new AppError("评论内容不能为空且最长 500 字", 400);
  return ok(await addComment(id, viewer, parsed.data.content, parsed.data.parentId));
});
