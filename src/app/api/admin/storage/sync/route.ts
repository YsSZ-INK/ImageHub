import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { syncR2Once, syncStatus } from "@/server/r2-sync.service";

export const runtime = "nodejs";
export const maxDuration = 300;

// R2 双向同步状态（供设置页轮询展示）
export const GET = handle(async () => ok(syncStatus()));

// 立即同步一轮：桶内对象 ⇋ 数据库记录双向对账
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  await syncR2Once();
  return ok(syncStatus());
});
