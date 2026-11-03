import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listImages, purgeExpiredTrash } from "@/server/image.service";
import type { ListParams } from "@/server/image.service";

export const runtime = "nodejs";

// 解析日期参数（无效格式忽略，保持宽容）
function parseDate(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// 图片列表（区分 scope）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") ?? "mine") as ListParams["scope"];

  // 打开个人面板时懒清理过期回收站
  if (scope === "trash" || scope === "mine") purgeExpiredTrash().catch(() => {});

  const { items, nextCursor, total } = await listImages({
    viewer,
    scope,
    albumId: url.searchParams.get("albumId") ?? undefined,
    username: url.searchParams.get("username") ?? undefined,
    sort: (url.searchParams.get("sort") as ListParams["sort"]) ?? "newest",
    cursor: url.searchParams.get("cursor") ?? undefined,
    take: Number(url.searchParams.get("take") ?? 24),
    storage: url.searchParams.get("storage") ?? undefined,
    // 我的图片筛选：gallery=in 已入画廊 / out 未入（相册归属复用上面的 albumId，none=未归类）
    gallery: ["in", "out"].includes(url.searchParams.get("gallery") ?? "")
      ? (url.searchParams.get("gallery") as "in" | "out")
      : undefined,
    // 日常记录筛选：上传者用户名 + 上传时间范围（可组合、可单独使用）
    owner: url.searchParams.get("owner") ?? undefined,
    from: parseDate(url.searchParams.get("from")),
    to: parseDate(url.searchParams.get("to")),
    // 日常记录（虚拟相册）：仅统计图文动态关联的图片
    posted: url.searchParams.get("posted") === "1" ? true : undefined,
  });
  return ok({ items, nextCursor, total });
});
