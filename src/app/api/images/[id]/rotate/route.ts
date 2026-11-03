import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { rotateImage } from "@/server/image.service";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({ dir: z.enum(["left", "right"]) });

// 旋转照片：dir=left 逆时针 90° / right 顺时针 90°（仅图片主人/超级管理员）
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const { dir } = bodySchema.parse(await req.json());
  return ok(await rotateImage(id, viewer, dir));
});
