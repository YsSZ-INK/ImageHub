import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { updateAvatar, publicUser } from "@/server/user.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 上传头像
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const rl = await rateLimit(`avatar:${user.id}`, 5, 60_000);
  if (!rl.success) throw new AppError("操作过于频繁", 429);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("缺少文件", 400);
  if (file.size > 5 * 1024 * 1024) throw new AppError("头像最大 5MB", 413);

  const buf = Buffer.from(await file.arrayBuffer());
  const updated = await updateAvatar(user, buf);
  return ok({ user: publicUser(updated) });
});
