import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listMyImageIds, listTrashedImageIds } from "@/server/image.service";

export const runtime = "nodejs";

// 跨页全选：scope=trash 返回回收站全部 id；默认返回「我的图片」全部 id
// （筛选口径与列表一致：存储位置 storage / 画廊进出 gallery / 相册归属 albumId，none=未归类）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const sp = new URL(req.url).searchParams;
  if (sp.get("scope") === "trash") return ok(await listTrashedImageIds(viewer));
  const gallery = sp.get("gallery");
  return ok(
    await listMyImageIds(
      viewer,
      sp.get("storage") ?? undefined,
      gallery === "in" || gallery === "out" ? gallery : undefined,
      sp.get("albumId") ?? undefined
    )
  );
});
