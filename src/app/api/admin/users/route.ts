import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiAdmin } from "@/lib/session";
import { adminUserCreateSchema } from "@/lib/validation";
import { adminCreateUser, adminListUsers } from "@/server/admin.service";
import { publicUser } from "@/server/user.service";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  // 安全员（渗透测试修复）：用户列表含全员邮箱/配额/封禁状态，必须 ADMIN
  const viewer = await requireApiAdmin();
  const url = new URL(req.url);
  const users = await adminListUsers(url.searchParams.get("search") ?? undefined);
  // isSelf：标记当前登录管理员自己，用于前端隐藏封禁按钮
  return ok(users.map((u) => ({ ...u, isSelf: u.id === viewer.id })));
});

// 创建用户（管理员）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await requireApiAdmin();
  const input = adminUserCreateSchema.parse(await req.json());
  const user = await adminCreateUser(input);
  return ok({ user: await publicUser(user) }, 201);
});
