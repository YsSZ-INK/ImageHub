import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminUserUpdateSchema } from "@/lib/validation";
import { adminUpdateUser, adminDeleteUser } from "@/server/admin.service";
import { publicUser } from "@/server/user.service";

export const runtime = "nodejs";

// 更新用户：封禁/角色/配额（管理员）
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { id } = await params;
  const input = adminUserUpdateSchema.parse(await req.json());
  const updated = await adminUpdateUser(viewer.id, id, input);
  return ok({ user: await publicUser(updated) });
});

// 删除用户：永久删除该用户全部数据（图片/相册/动态/存储对象），不可恢复
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { id } = await params;
  await adminDeleteUser(viewer.id, id);
  return ok({ deleted: true });
});
