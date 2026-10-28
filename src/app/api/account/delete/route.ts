import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { deleteAccount } from "@/server/user.service";

export const runtime = "nodejs";

// 账号注销：级联删除图片与存储对象
export const DELETE = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  await deleteAccount(user);
  return ok({ message: "账号已注销" });
});
