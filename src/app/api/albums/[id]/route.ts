import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { albumUpdateSchema } from "@/lib/validation";
import { updateAlbum, deleteAlbum } from "@/server/image.service";

export const runtime = "nodejs";

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  const input = albumUpdateSchema.parse(await req.json());
  return ok(await updateAlbum(id, viewer, input));
});

export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const { id } = await params;
  await deleteAlbum(id, viewer);
  return ok({ message: "相册已删除" });
});
