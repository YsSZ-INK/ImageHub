import { handle, ok } from "@/lib/api";
import { requireApiAdmin } from "@/lib/session";
import { adminListPendingImages } from "@/server/admin.service";

export const runtime = "nodejs";

// 待审核图片队列（仅 status=PENDING，页码分页）
export const GET = handle(async (req: Request) => {
  await requireApiAdmin();
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page")) || 1;
  return ok(await adminListPendingImages(page));
});
