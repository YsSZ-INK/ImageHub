import { statSync } from "fs";
import { handle, assertSameOrigin } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { backupDownloadStream, createBackupFile } from "@/server/backup.service";

// 生成并下载站点备份（单文件 .tar.gz，含数据库 + 全部存储文件）
// 用 POST + 同源校验：备份含全站数据，若用 GET，跨站的 <a>/<form> 标签会带着 Cookie
// 静默触发（Lax 下顶层 GET 导航会带会话）；POST 不会被跨站导航自动触发，
// 同源校验还能拒绝第三方页面的 fetch。
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await requireApiSuper();
  const { file, counts, cleanup } = await createBackupFile();
  const filename = file.split(/[\\/]/).pop() ?? "imagehub-backup.tar.gz";
  return new Response(backupDownloadStream(file, cleanup), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(statSync(file).size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Backup-Counts": JSON.stringify(counts),
    },
  });
});
