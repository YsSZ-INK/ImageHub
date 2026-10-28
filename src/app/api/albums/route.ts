import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { albumCreateSchema } from "@/lib/validation";
import { listAlbums, createAlbum } from "@/server/image.service";

export const runtime = "nodejs";

// 相册列表（scope=all 全部可见 / mine 我的全部）
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const url = new URL(req.url);
  const username = url.searchParams.get("username") ?? undefined;
  return ok(await listAlbums(viewer, username));
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const input = albumCreateSchema.parse(await req.json());
  return ok(await createAlbum(viewer, input), 201);
});
