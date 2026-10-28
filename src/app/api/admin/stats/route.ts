import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { adminStats } from "@/server/admin.service";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") return ok(null, 403);
  return ok(await adminStats());
});
