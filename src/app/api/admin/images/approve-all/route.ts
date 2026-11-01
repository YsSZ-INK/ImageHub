import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiAdmin } from "@/lib/session";
import { adminApproveAllImages } from "@/server/admin.service";
import { logActivity } from "@/server/audit.service";

export const runtime = "nodejs";

// 全部通过：待审核队列一键全部发布（静态段优先于 [id] 动态路由，不会冲突）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiAdmin();
  const r = await adminApproveAllImages();
  await logActivity(viewer.id, "admin_review", `一键通过了 ${r.affected} 张图片的审核`);
  return ok(r);
});
