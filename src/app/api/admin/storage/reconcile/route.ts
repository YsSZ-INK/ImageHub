import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { reconcileR2, purgeMissingR2 } from "@/server/reconcile.service";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  action: z.enum(["check", "cleanup"]),
  ids: z.array(z.string()).max(100000).optional(),
});

// R2 记录一致性校验（check）/ 清理缺失记录（cleanup，仅限 check 返回过的 id）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { action, ids } = schema.parse(await req.json());
  if (action === "check") return ok(await reconcileR2());
  const count = await purgeMissingR2((ids ?? []).filter((id) => /^[a-z0-9]+$/i.test(id)));
  return ok({ cleaned: count });
});
