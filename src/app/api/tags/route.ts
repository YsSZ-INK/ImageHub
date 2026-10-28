import { handle, assertSameOrigin, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { tagCreateSchema } from "@/lib/validation";
import { listTags, createTag } from "@/server/image.service";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  const url = new URL(req.url);
  const username = url.searchParams.get("username") ?? undefined;
  return ok(await listTags(viewer, username));
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  const input = tagCreateSchema.parse(await req.json());
  return ok(await createTag(viewer, input), 201);
});
