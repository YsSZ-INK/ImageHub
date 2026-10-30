import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { postCreateSchema } from "@/lib/validation";
import { listPosts, createPost } from "@/server/post.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 动态列表（朋友圈式 feed，游标分页；可选 from/to 时间范围过滤，ISO 时间戳）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  let range: { from?: Date; to?: Date } | undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    range = {};
    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) throw new AppError("开始时间格式错误", 400);
      range.from = d;
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) throw new AppError("结束时间格式错误", 400);
      range.to = d;
    }
  }
  return ok(await listPosts(viewer, cursor, 10, range));
});

// 发布动态：文字 + 1~9 张本人的图片（图片转公开并归入默认相册「日常记录」）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();

  const rl = await rateLimit(`post:${user.id}`, 10, 60_000);
  if (!rl.success) throw new AppError("发布过于频繁，请稍后再试", 429);

  const input = postCreateSchema.parse(await req.json());
  return ok(await createPost(user, input), 201);
});
