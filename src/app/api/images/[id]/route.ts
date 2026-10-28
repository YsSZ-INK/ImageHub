import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { imageUpdateSchema } from "@/lib/validation";
import { getImageDetail, updateImage, softDeleteImage } from "@/server/image.service";

export const runtime = "nodejs";

// 图片详情
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await requireApiUser();
  const { id } = await params;
  return ok(await getImageDetail(id, viewer));
});

// 更新文件名/可见性/相册
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const input = imageUpdateSchema.parse(await req.json());
  return ok(await updateImage(id, viewer, input));
});

// 软删除（进回收站）
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  await softDeleteImage(id, viewer);
  return ok({ message: "已移入回收站" });
});
