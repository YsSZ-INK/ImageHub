import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { c as tarCreate, x as tarExtract } from "tar";
import { prisma } from "@/lib/db";
import { storageRoot } from "@/lib/storage/local";
import { AppError } from "@/lib/api";

/**
 * 站点备份 / 还原
 * 备份文件：单个 .tar.gz（gzip 最高压缩），包含
 *   backup.json  —— 元信息（应用标识 / 版本 / 时间 / 数量统计）
 *   db.json      —— 全部数据库表数据（JSON，BigInt 字段转字符串）
 *   files/**     —— 存储目录全部文件（图片原图、缩略图、视频）
 * 还原：上传同一备份文件，清空并重建数据库数据、替换存储文件。
 */

const BACKUP_MAGIC = { app: "imagehub", version: 1 } as const;

// JSON 序列化：BigInt → 字符串（User.storageQuota / storageUsed）
function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

type DbDump = {
  settings: unknown[];
  users: unknown[];
  albums: unknown[];
  posts: unknown[];
  images: unknown[];
  apiTokens: unknown[];
  tokens: unknown[];
  accounts: unknown[];
  sessions: unknown[];
};

// 导出全部表数据（cuid 主键，无自增序列，直接整表导出即可）
async function dumpDatabase(): Promise<{ rows: DbDump; counts: Record<string, number> }> {
  const [settings, users, albums, posts, images, apiTokens, tokens, accounts, sessions] =
    await Promise.all([
      prisma.setting.findMany(),
      prisma.user.findMany(),
      prisma.album.findMany(),
      prisma.post.findMany(),
      prisma.image.findMany(),
      prisma.apiToken.findMany(),
      prisma.token.findMany(),
      prisma.account.findMany(),
      prisma.session.findMany(),
    ]);
  const rows: DbDump = { settings, users, albums, posts, images, apiTokens, tokens, accounts, sessions };
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  return { rows, counts };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// 生成备份压缩包，返回文件路径与清理函数（下载完成后务必调用 cleanup）
export async function createBackupFile(): Promise<{
  file: string;
  counts: Record<string, number>;
  cleanup: () => Promise<void>;
}> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "ihbackup-"));
  const file = path.join(os.tmpdir(), `imagehub-backup-${stamp()}.tar.gz`);
  try {
    const { rows, counts } = await dumpDatabase();
    await fs.writeFile(path.join(staging, "db.json"), jsonSafe(rows), "utf8");
    await fs.writeFile(
      path.join(staging, "backup.json"),
      JSON.stringify({ ...BACKUP_MAGIC, createdAt: new Date().toISOString(), counts }),
      "utf8"
    );
    // 存储目录 → files/**（目录不存在时跳过）
    const root = storageRoot();
    if (await pathExists(root)) {
      await fs.cp(root, path.join(staging, "files"), { recursive: true });
    } else {
      await fs.mkdir(path.join(staging, "files"), { recursive: true });
    }
    // 打包：gzip 最高压缩，portable 保证跨平台路径
    await tarCreate(
      { gzip: { level: 9 }, file, cwd: staging, portable: true },
      ["backup.json", "db.json", "files"]
    );
    return { file, counts, cleanup: () => cleanupAll(staging, file) };
  } catch (err) {
    await cleanupAll(staging, file);
    throw err;
  }
}

async function cleanupAll(staging: string, file: string): Promise<void> {
  await Promise.all([
    fs.rm(staging, { recursive: true, force: true }),
    fs.rm(file, { force: true }),
  ]);
}

// 还原：从上传流解包 → 校验 → 事务重建数据库 → 替换存储文件
export async function restoreBackup(body: ReadableStream): Promise<{
  counts: Record<string, number>;
  files: number;
}> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "ihrestore-"));
  try {
    // 流式解包（tar.x 自动识别 gzip）
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), tarExtract({ cwd: staging }));

    // 校验备份文件
    const metaPath = path.join(staging, "backup.json");
    const dbPath = path.join(staging, "db.json");
    if (!(await pathExists(metaPath)) || !(await pathExists(dbPath))) {
      throw new AppError("无效的备份文件（缺少 backup.json / db.json）", 400);
    }
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as { app?: string; version?: number };
    if (meta.app !== BACKUP_MAGIC.app || meta.version !== BACKUP_MAGIC.version) {
      throw new AppError("不是 ImageHub 的备份文件，或版本不兼容", 400);
    }
    const rows = JSON.parse(await fs.readFile(dbPath, "utf8")) as DbDump;
    for (const key of Object.keys(rows) as (keyof DbDump)[]) {
      if (!Array.isArray(rows[key])) throw new AppError("备份数据不完整", 400);
    }

    // 事务重建数据库（大数据量放宽超时；按依赖顺序清空与重建）
    await prisma.$transaction(
      async (tx) => {
        await tx.account.deleteMany();
        await tx.session.deleteMany();
        await tx.apiToken.deleteMany();
        await tx.token.deleteMany();
        await tx.image.deleteMany();
        await tx.post.deleteMany();
        await tx.album.deleteMany();
        await tx.user.deleteMany();
        await tx.setting.deleteMany();

        // BigInt 字段还原（JSON 中为字符串）
        const users = (rows.users as Record<string, unknown>[]).map((u) => ({
          ...u,
          storageQuota: BigInt(String(u.storageQuota ?? "0")),
          storageUsed: BigInt(String(u.storageUsed ?? "0")),
        }));
        await tx.user.createMany({ data: users as never });
        await tx.album.createMany({ data: rows.albums as never });
        await tx.post.createMany({ data: rows.posts as never });
        await tx.image.createMany({ data: rows.images as never });
        await tx.apiToken.createMany({ data: rows.apiTokens as never });
        await tx.token.createMany({ data: rows.tokens as never });
        await tx.setting.createMany({ data: rows.settings as never });
        await tx.account.createMany({ data: rows.accounts as never });
        await tx.session.createMany({ data: rows.sessions as never });
      },
      { timeout: 120_000, maxWait: 10_000 }
    );

    // 替换存储文件：先清空再写回（数据库已恢复，文件以备份为准）
    const root = storageRoot();
    await fs.mkdir(root, { recursive: true });
    for (const entry of await fs.readdir(root)) {
      await fs.rm(path.join(root, entry), { recursive: true, force: true });
    }
    let files = 0;
    const src = path.join(staging, "files");
    if (await pathExists(src)) {
      await fs.cp(src, root, { recursive: true });
      files = (await countFiles(root)).total;
    }
    return { counts: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])), files };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function countFiles(dir: string): Promise<{ total: number }> {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += (await countFiles(p)).total;
    else total += 1;
  }
  return { total };
}

// 下载流：读取备份文件并在结束后清理临时产物
export function backupDownloadStream(file: string, cleanup: () => Promise<void>): ReadableStream {
  const stream = createReadStream(file);
  void new Promise<void>((resolve) => stream.on("close", resolve)).then(() => cleanup());
  return Readable.toWeb(stream) as ReadableStream;
}
