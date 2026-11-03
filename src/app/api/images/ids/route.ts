import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listMyImageIds, listTrashedImageIds } from "@/server/image.service";

export const runtime = "nodejs";

// 跨页全选：scope=trash 返回回收站全部 id，默认返回「我的图片」全部 id（均可选按存储位置筛选）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const sp = new URL(req.url).searchParams;
  if (sp.get("scope") === "trash") return ok(await listTrashedImageIds(viewer));
  const storage = sp.get("storage") ?? undefined;
  return ok(await listMyImageIds(viewer, storage));
});
