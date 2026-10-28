/**
 * 演示数据：1 个管理员 + 2 个普通用户 + 若干示例图片（取自 public/ 水墨画，与站点主题一致）
 * 运行：npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { createHash } from "crypto";
import { encode } from "blurhash";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";

const prisma = new PrismaClient();

// 水墨示例图：源文件 -> 展示名（下标与文件一一对应，跨用户复用同源图）
const INK_SOURCES = [
  { file: "ink-1.png", label: "远岫" },
  { file: "ink-2.png", label: "烟江" },
  { file: "ink-3.png", label: "寒林" },
  { file: "ink-4.png", label: "暮山" },
  { file: "ink-1.png", label: "溪云" },
  { file: "ink-2.png", label: "空谷" },
];

async function makeImageFromInk(userId: string, srcFile: string, label: string, seq: number) {
  const src = path.resolve(process.cwd(), "public", srcFile);
  // 主图限宽 2000（保持画质与体积平衡），统一 PNG
  const main = await sharp(src).resize({ width: 2000, withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(main).metadata();
  const thumb = await sharp(main).resize({ width: 400, withoutEnlargement: true }).webp().toBuffer();

  const { data, info } = await sharp(main).resize(32, 24, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blurhash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);

  const sha256 = createHash("sha256").update(main).digest("hex");
  const base = `ink-${seq}`;
  const storageKey = `seed/${userId}/${base}.png`;
  const thumbKey = `seed/${userId}/${base}.webp`;

  const storageDir = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? "./storage");
  mkdirSync(path.dirname(path.join(storageDir, storageKey)), { recursive: true });
  writeFileSync(path.join(storageDir, storageKey), main);
  writeFileSync(path.join(storageDir, thumbKey), thumb);

  return {
    userId,
    filename: `${label}.png`,
    storageKey,
    thumbKey,
    mimeType: "image/png",
    size: main.length,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    sha256,
    blurhash,
    visibility: "PUBLIC",
  };
}

async function main() {
  console.log("开始生成演示数据…");
  const passwordHash = await bcrypt.hash("Abc12345", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@imagehub.local" },
    // 账号已存在时也要纠正角色与密码（避免此前被普通注册覆盖）
    update: { passwordHash, role: "ADMIN" },
    create: {
      email: "admin@imagehub.local",
      name: "admin",
      passwordHash,
      role: "ADMIN",
    },
  });

  const alice = await prisma.user.upsert({
    where: { email: "alice@imagehub.local" },
    update: {},
    create: { email: "alice@imagehub.local", name: "alice", passwordHash },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@imagehub.local" },
    update: {},
    create: { email: "bob@imagehub.local", name: "bob", passwordHash },
  });

  // 相册
  const album = await prisma.album.upsert({
    where: { userId_slug: { userId: alice.id, slug: "travel" } },
    update: {},
    create: { userId: alice.id, name: "旅行", slug: "travel", description: "示例相册" },
  });

  // 清掉旧版纯色示例图（仅限 seed/ 前缀，不影响真实上传）
  await prisma.image.deleteMany({ where: { storageKey: { startsWith: "seed/" } } });
  const storageRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? "./storage");
  rmSync(path.join(storageRoot, "seed"), { recursive: true, force: true });

  // 示例图片（水墨画）
  const users = [
    { u: alice, visibility: ["PUBLIC", "PUBLIC", "PRIVATE"] },
    { u: bob, visibility: ["PUBLIC", "UNLISTED", "PUBLIC"] },
  ];

  let seq = 0;
  for (const { u, visibility } of users) {
    for (let i = 0; i < 3; i++) {
      const src = INK_SOURCES[seq];
      const data = await makeImageFromInk(u.id, src.file, src.label, seq + 1);
      const exists = await prisma.image.findFirst({ where: { userId: u.id, filename: data.filename } });
      if (!exists) await prisma.image.create({ data: { ...data, visibility: visibility[i] } });
      seq++;
    }
  }

  // 把 Alice 第 1 张放进相册
  const first = await prisma.image.findFirst({ where: { userId: alice.id, filename: "远岫.png" } });
  if (first) {
    await prisma.image.update({ where: { id: first.id }, data: { albumId: album.id } });
  }

  // 不生成演示标签（用户按需自行创建）
  await prisma.imageTag.deleteMany({});
  await prisma.tag.deleteMany({});
  // 配额统计
  for (const u of [admin, alice, bob]) {
    const agg = await prisma.image.aggregate({ where: { userId: u.id }, _sum: { size: true } });
    await prisma.user.update({ where: { id: u.id }, data: { storageUsed: agg._sum.size ?? 0 } });
  }

  console.log("演示数据生成完成：");
  console.log("  管理员  admin@imagehub.local / Abc12345");
  console.log("  用户    alice@imagehub.local / Abc12345");
  console.log("  用户    bob@imagehub.local   / Abc12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
