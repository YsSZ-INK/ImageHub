import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { scanBucketOrphans, deleteBucketOrphans, adoptBucketObjects } from "@/server/reconcile.service";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

const itemsSchema = z
  .array(z.object({ slot: z.string().regex(/^r2:\d+$/), key: z.string().min(1).max(1024) }))
  .min(1)
  .max(2000);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("delete"), items: itemsSchema }),
  // 收录：把桶内文件下载到本地并建记录，成功后删除桶内副本
  z.object({ action: z.literal("adopt"), items: itemsSchema }),
]);

// 桶内多余文件核对（check）/ 删除桶内多余对象（delete）/ 移入网站（adopt，仅限核对列出的 key）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiSuper();
  const body = schema.parse(await req.json());
  if (body.action === "check") return ok(await scanBucketOrphans());
  if (body.action === "adopt") return ok(await adoptBucketObjects(body.items, viewer));
  return ok(await deleteBucketOrphans(body.items));
});
