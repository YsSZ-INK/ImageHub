import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { updateTag, deleteTag } from "@/server/image.service";

export const runtime = "nodejs";

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const body = (await req.json()) as { name?: string };
  if (!body.name) throw new AppError("标签名不能为空", 400);
  return ok(await updateTag(id, viewer, body.name.trim()));
});

export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  await deleteTag(id, viewer);
  return ok({ message: "标签已删除" });
});
