import { statSync } from "fs";
import { handle } from "@/lib/api";
import { requireApiAdmin } from "@/lib/session";
import { backupDownloadStream, createBackupFile } from "@/server/backup.service";

// 生成并下载站点备份（单文件 .tar.gz，含数据库 + 全部存储文件）
export const GET = handle(async () => {
  await requireApiAdmin();
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
