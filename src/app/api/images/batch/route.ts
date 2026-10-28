import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { batchActionSchema } from "@/lib/validation";
import { batchImages } from "@/server/image.service";

export const runtime = "nodejs";

// 批量操作：删除/恢复/彻底删除/可见性/移动相册/打标签/去标签
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const input = batchActionSchema.parse(await req.json());
  return ok(await batchImages(viewer, input));
});
