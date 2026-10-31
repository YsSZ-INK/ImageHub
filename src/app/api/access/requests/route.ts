import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listMyAccess } from "@/server/access.service";

export const runtime = "nodejs";

// 我的图片访问申请：收到的（待审批）+ 发出的 + 双向已授权名单
export const GET = handle(async () => {
  const viewer = await requireApiUser();
  return ok(await listMyAccess(viewer));
});
