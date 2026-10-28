import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminSettingsSchema } from "@/lib/validation";
import { getSettings, saveSettings } from "@/lib/settings";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  return ok(await getSettings());
});

export const PUT = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const input = adminSettingsSchema.parse(await req.json());
  await saveSettings(input);
  return ok({ message: "设置已保存" });
});
