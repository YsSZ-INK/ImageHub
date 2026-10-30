import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiAdmin } from "@/lib/session";
import { restoreBackup } from "@/server/backup.service";

// 还原站点备份：请求体即备份文件原始字节（流式解包，覆盖全部数据与存储）
export const POST = handle(async (req: Request) => {
  await requireApiAdmin();
  assertSameOrigin(req);
  if (!req.body) throw new AppError("缺少备份文件", 400);
  const ct = req.headers.get("content-type") ?? "";
  if (!/gzip|tar|octet-stream/i.test(ct)) {
    throw new AppError("请上传 .tar.gz 备份文件", 400);
  }
  const result = await restoreBackup(req.body);
  return ok({
    message: `还原完成：用户 ${result.counts.users ?? 0} · 图片 ${result.counts.images ?? 0} · 相册 ${result.counts.albums ?? 0} · 动态 ${result.counts.posts ?? 0} · 文件 ${result.files}`,
  });
});
