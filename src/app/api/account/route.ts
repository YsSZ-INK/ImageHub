import { handle, assertSameOrigin, ok } from "@/lib/api";
import { profileSchema } from "@/lib/validation";
import { requireApiUser } from "@/lib/session";
import { updateProfile, publicUser } from "@/server/user.service";

export const runtime = "nodejs";

// 修改昵称/头像地址
export const PATCH = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const input = profileSchema.parse(await req.json());
  const updated = await updateProfile(user, input);
  return ok({ user: await publicUser(updated) });
});
