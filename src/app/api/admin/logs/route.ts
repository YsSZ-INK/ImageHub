import { handle, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { listActivityLogs } from "@/server/audit.service";

export const runtime = "nodejs";

// 站点操作日志（管理员）：人类可读句子，按时间倒序分页
export const GET = handle(async (req: Request) => {
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const page = new URL(req.url).searchParams.get("page") ?? "1";
  return ok(await listActivityLogs(parseInt(page, 10) || 1));
});
