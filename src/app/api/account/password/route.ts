import { handle, assertSameOrigin, ok } from "@/lib/api";
import { changePasswordSchema } from "@/lib/validation";
import { requireApiUser } from "@/lib/session";
import { changePassword } from "@/server/user.service";

export const runtime = "nodejs";

// 修改密码
export const PUT = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const input = changePasswordSchema.parse(await req.json());
  await changePassword(user, input);
  return ok({ message: "密码已更新" });
});
