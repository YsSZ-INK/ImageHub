import { handle, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getR2Usage } from "@/lib/storage/r2";
import { r2SlotIndex, r2SlotLabel } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// R2 桶实时用量（仅管理员）：ListObjectsV2 逐页累加，大桶耗时较长；?slot=r2:<n> 指定槽位（默认 r2:0）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const raw = new URL(req.url).searchParams.get("slot") ?? "r2:0";
  if (!/^r2:\d+$/.test(raw)) throw new AppError("无效的存储位置", 400);
  const idx = r2SlotIndex(raw);
  const s = await getSettings();
  const cfg = s.r2Slots[idx];
  if (!cfg || !cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
    throw new AppError(`${r2SlotLabel(idx)}尚未配置完整`, 400);
  }
  try {
    const usage = await getR2Usage(cfg);
    return ok(usage);
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    if (name === "AccessDenied") throw new AppError("R2 令牌缺少对象列表权限（需包含 Object Read）", 400);
    throw new AppError("R2 用量查询失败，请检查网络与令牌配置", 500);
  }
});
