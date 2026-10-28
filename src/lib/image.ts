import sharp from "sharp";
import { createHash, randomBytes } from "crypto";
import { encode } from "blurhash";
import { getStorage } from "@/lib/storage";
import { AppError } from "@/lib/api";

// 允许的图片类型白名单
export const ALLOWED_MIMES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;

export type AllowedMime = keyof typeof ALLOWED_MIMES;

/**
 * MIME + 文件魔数双重校验
 * 返回实际检测出的 mime；不在白名单返回 null
 */
export function detectImageMime(buf: Buffer): AllowedMime | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  )
    return "image/png";
  // GIF: GIF87a / GIF89a
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  // WebP: RIFF....WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  // AVIF: ....ftypavif
  if (buf.toString("ascii", 4, 8) === "ftyp" && buf.toString("ascii", 8, 12).startsWith("avif"))
    return "image/avif";
  return null;
}

export type ProcessedUpload = {
  filename: string;
  storageKey: string;
  thumbKey: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  sha256: string;
  blurhash: string | null;
};

function sanitizeName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  return base.slice(0, 100) || "image";
}

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 图片处理流水线：
 * 1. 魔数校验 2. sha256 去重 3. EXIF 剥离（sharp 默认剥离，含 GPS）
 * 4. 可选 WebP 转码 5. 400px 缩略图（WebP）6. blurhash 占位
 * 返回处理结果并把对象写入存储（key 不对外暴露）。
 */
export async function processAndStoreImage(
  buf: Buffer,
  userId: string,
  originalName: string
): Promise<ProcessedUpload> {
  const mime = detectImageMime(buf);
  if (!mime) throw new AppError("不支持的图片格式（仅允许 jpg/png/webp/gif/avif）", 415);

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const convertWebp = process.env.CONVERT_TO_WEBP === "true" && (mime === "image/jpeg" || mime === "image/png");

  // sharp 默认剥离全部元数据（EXIF/GPS），除非显式 withMetadata
  const pipeline = sharp(buf).rotate(); // rotate 按 EXIF 方向摆正后再剥离

  let mainBuf: Buffer;
  let mainMime: string;
  let ext: string;

  if (convertWebp) {
    mainBuf = await pipeline.webp({ quality: 82 }).toBuffer();
    mainMime = "image/webp";
    ext = "webp";
  } else if (mime === "image/gif") {
    // 动图保持原样（sharp 不处理动图帧）
    mainBuf = buf;
    mainMime = mime;
    ext = "gif";
  } else {
    mainBuf = await pipeline.toBuffer();
    mainMime = mime;
    ext = ALLOWED_MIMES[mime];
  }

  // 元信息（rotate 后的实际显示尺寸）
  const meta = await sharp(mainBuf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // 缩略图：最长边 400px，WebP
  const thumbBuf =
    mime === "image/gif"
      ? await sharp(buf, { animated: false }).resize({ width: 400, withoutEnlargement: true }).webp().toBuffer()
      : await sharp(mainBuf).resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).webp().toBuffer();

  // blurhash 占位图（小尺寸采样）
  let blurhash: string | null = null;
  try {
    const { data, info } = await sharp(mainBuf)
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    blurhash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    // blurhash 失败不阻塞上传
  }

  const storage = await getStorage();
  const rand = randomBytes(4).toString("hex");
  const storageKey = `images/${userId}/${monthKey()}/${sha256.slice(0, 16)}-${rand}.${ext}`;
  const thumbKey = `thumbs/${userId}/${monthKey()}/${sha256.slice(0, 16)}-${rand}.webp`;

  await storage.put(storageKey, mainBuf, { contentType: mainMime });
  await storage.put(thumbKey, thumbBuf, { contentType: "image/webp" });

  return {
    filename: sanitizeName(originalName),
    storageKey,
    thumbKey,
    mimeType: mainMime,
    size: mainBuf.length,
    width,
    height,
    sha256,
    blurhash,
  };
}

// 头像处理：256px WebP
export async function processAndStoreAvatar(buf: Buffer, userId: string): Promise<string> {
  const mime = detectImageMime(buf);
  if (!mime) throw new AppError("不支持的图片格式", 415);
  const out = await sharp(buf)
    .rotate()
    .resize(256, 256, { fit: "cover" })
    .webp()
    .toBuffer();
  const key = `avatars/${userId}.webp`;
  await (await getStorage()).put(key, out, { contentType: "image/webp" });
  return key;
}
