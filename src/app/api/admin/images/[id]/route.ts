import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminTakedownImage, adminPurgeImage } from "@/server/admin.service";
import { approveImage } from "@/server/image.service";
import { logActivity } from "@/server/audit.service";

export const runtime = "nodejs";

// 审核通过：待审核图片进入画廊
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const r = await approveImage(id, viewer);
  await logActivity(viewer.id, "admin_review", `通过了图片「${r.filename}」的审核`);
  return ok(r);
});

// 下架（改 PRIVATE）
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { id } = await params;
  const r = await adminTakedownImage(id);
  await logActivity(viewer.id, "admin_review", "把一张图片下架（设为私有）");
  return ok(r);
});

// 彻底删除
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { id } = await params;
  await adminPurgeImage(id);
  await logActivity(viewer.id, "admin_review", "彻底删除了一张图片");
  return ok({ message: "图片已彻底删除" });
});
