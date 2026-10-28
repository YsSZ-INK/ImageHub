import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminListUsers } from "@/server/admin.service";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  await requireApiUser();
  const url = new URL(req.url);
  return ok(await adminListUsers(url.searchParams.get("search") ?? undefined));
});
