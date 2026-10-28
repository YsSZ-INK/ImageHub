import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminListImages } from "@/server/admin.service";

export const runtime = "nodejs";

// 全站图片审核列表
export const GET = handle(async (req: Request) => {
  await requireApiUser();
  const url = new URL(req.url);
  return ok(await adminListImages(url.searchParams.get("cursor") ?? undefined));
});
