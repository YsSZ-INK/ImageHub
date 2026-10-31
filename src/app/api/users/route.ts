import { handle, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listUserDirectory } from "@/server/access.service";

export const runtime = "nodejs";

// 用户目录：全部 ACTIVE 用户 + 与我的授权关系状态
export const GET = handle(async () => {
  const viewer = await requireApiUser();
  return ok({ users: await listUserDirectory(viewer) });
});
