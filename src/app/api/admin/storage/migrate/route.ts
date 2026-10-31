import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { startMigration, migrationStatus } from "@/server/migration.service";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z
  .object({
    from: z.string().regex(/^(local|r2:\d+)$/, "无效的存储位置"),
    to: z.string().regex(/^(local|r2:\d+)$/, "无效的存储位置"),
    ids: z.array(z.string()).optional(),
  })
  .refine((v) => v.from !== v.to, { message: "源位置与目标位置相同" });

// 发起存量迁移（后台执行，立即返回）；指定 ids 时仅迁移勾选的图片
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const { from, to, ids } = schema.parse(await req.json());
  await startMigration(from, to, ids);
  return ok({ message: "迁移已开始" });
});

// 查询迁移进度（前端 2s 轮询）
export const GET = handle(async () => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  return ok(migrationStatus());
});
