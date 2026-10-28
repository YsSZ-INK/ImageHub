import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminTakedownImage, adminPurgeImage } from "@/server/admin.service";

export const runtime = "nodejs";

// 下架（改 PRIVATE）
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { id } = await params;
  return ok(await adminTakedownImage(id));
});

// 彻底删除
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { id } = await params;
  await adminPurgeImage(id);
  return ok({ message: "图片已彻底删除" });
});
