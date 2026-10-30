import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminSettingsSchema } from "@/lib/validation";
import { getSettings, saveSettings, sanitizeSettings } from "@/lib/settings";

export const runtime = "nodejs";

// 返回前脱敏：R2 Secret / SMTP 授权码永不下发浏览器（置空 + has* 标记）
export const GET = handle(async () => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  return ok(sanitizeSettings(await getSettings()));
});

export const PUT = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const input = adminSettingsSchema.parse(await req.json());
  // 密钥只写不读：提交留空表示保持原值
  const current = await getSettings();
  if (input.smtpPass === "") input.smtpPass = current.smtpPass;
  input.r2Slots = input.r2Slots.map((slot) => {
    if (slot.secretAccessKey) return slot;
    // 留空：按 (accountId, accessKeyId, bucket) 匹配已存槽位继承 Secret；匹配不到则视为未配置
    const prev = current.r2Slots.find(
      (p) => p.accountId === slot.accountId && p.accessKeyId === slot.accessKeyId && p.bucket === slot.bucket
    );
    return { ...slot, secretAccessKey: prev?.secretAccessKey ?? "" };
  });
  // 合并后不允许出现「填了一半」的槽位（配置了三项却无密钥），避免保存后无法使用
  for (let i = 0; i < input.r2Slots.length; i++) {
    const s = input.r2Slots[i];
    const touched = s.accountId || s.accessKeyId || s.bucket;
    if (touched && !(s.accountId && s.accessKeyId && s.secretAccessKey && s.bucket)) {
      throw new AppError(`R2 桶 ${i + 1} 配置不完整：修改过密钥或新桶需填写完整四项`, 400);
    }
  }
  await saveSettings(input);
  return ok({ message: "设置已保存" });
});
