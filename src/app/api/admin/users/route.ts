import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminUserCreateSchema } from "@/lib/validation";
import { adminCreateUser, adminListUsers } from "@/server/admin.service";
import { publicUser } from "@/server/user.service";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const url = new URL(req.url);
  const users = await adminListUsers(url.searchParams.get("search") ?? undefined);
  // isSelf：标记当前登录管理员自己，用于前端隐藏封禁按钮
  return ok(users.map((u) => ({ ...u, isSelf: u.id === viewer.id })));
});

// 创建用户（管理员）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const input = adminUserCreateSchema.parse(await req.json());
  const user = await adminCreateUser(input);
  return ok({ user: await publicUser(user) }, 201);
});
