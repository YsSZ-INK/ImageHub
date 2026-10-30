import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminUserCreateSchema } from "@/lib/validation";
import { adminCreateUser, adminListUsers } from "@/server/admin.service";
import { publicUser } from "@/server/user.service";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  await requireApiUser();
  const url = new URL(req.url);
  return ok(await adminListUsers(url.searchParams.get("search") ?? undefined));
});

// 创建用户（管理员）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const input = adminUserCreateSchema.parse(await req.json());
  const user = await adminCreateUser(input);
  return ok({ user: publicUser(user) }, 201);
});
