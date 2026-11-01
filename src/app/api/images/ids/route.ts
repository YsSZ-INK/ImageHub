import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listMyImageIds } from "@/server/image.service";

export const runtime = "nodejs";

// 「我的图片」跨页全选：返回当前筛选（可选按存储位置）下全部图片 id（仅本人）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const storage = new URL(req.url).searchParams.get("storage") ?? undefined;
  return ok(await listMyImageIds(viewer, storage));
});
