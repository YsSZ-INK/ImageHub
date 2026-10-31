import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listImages, purgeExpiredTrash } from "@/server/image.service";
import type { ListParams } from "@/server/image.service";

export const runtime = "nodejs";

// 图片列表（区分 scope）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") ?? "mine") as ListParams["scope"];

  // 打开个人面板时懒清理过期回收站
  if (scope === "trash" || scope === "mine") purgeExpiredTrash().catch(() => {});

  const { items, nextCursor } = await listImages({
    viewer,
    scope,
    albumId: url.searchParams.get("albumId") ?? undefined,
    username: url.searchParams.get("username") ?? undefined,
    sort: (url.searchParams.get("sort") as ListParams["sort"]) ?? "newest",
    cursor: url.searchParams.get("cursor") ?? undefined,
    take: Number(url.searchParams.get("take") ?? 24),
    storage: url.searchParams.get("storage") ?? undefined,
  });
  return ok({ items, nextCursor });
});
