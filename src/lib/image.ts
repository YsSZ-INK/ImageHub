import sharp from "sharp";
import { createHash, randomBytes } from "crypto";
import { encode } from "blurhash";
import { getStorageFor, getLocalStorage, getUploadMarker } from "@/lib/storage";
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

// 允许的视频类型白名单（浏览器原生可播放）
export const ALLOWED_VIDEO_MIMES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
} as const;

/**
 * 视频魔数校验：
 * - MP4/M4V/MOV: 偏移 4-8 为 "ftyp" + 品牌（isom/mp41/qt 等注：avif/avis/heic 品牌不在此匹配，走图片分支）
 * - WebM/MKV: EBML 头 1A 45 DF A3，再按 DocType 区分
 * 返回实际检测出的 mime；不是受支持的视频返回 null
 */
export function detectVideoMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand.startsWith("qt")) return "video/quicktime";
    if (/^(isom|iso2|mp41|mp42|avc1|dash|MSNV|mmp4|mp71)/i.test(brand) || /^mp/i.test(brand) || /^m4v/i.test(brand))
      return "video/mp4";
    return null;
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = buf.subarray(0, 64).toString("latin1");
    if (head.includes("webm")) return "video/webm";
    if (head.includes("matroska")) return "video/x-matroska";
    return null;
  }
  return null;
}

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
  // 文件实际写入的存储驱动（local | r2），随上传记录到 Image.storage
  storage: string;
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
  if (!mime) throw new AppError("不支持的图片格式（仅允许 jpg/jpeg/png/webp/gif/avif）", 415);

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const convertWebP = process.env.CONVERT_TO_WEBP === "true" && (mime === "image/jpeg" || mime === "image/png");

  // 元信息：只读元数据不解码像素；按 EXIF 方向换算 rotate 后的显示尺寸（方向 5-8 含 90°/270° 旋转需交换宽高）
  const srcMeta = await sharp(buf).metadata();
  const swap = srcMeta.orientation !== undefined && srcMeta.orientation >= 5 && srcMeta.orientation <= 8;
  const width = swap ? (srcMeta.height ?? 0) : (srcMeta.width ?? 0);
  const height = swap ? (srcMeta.width ?? 0) : (srcMeta.height ?? 0);

  // sharp 默认剥离全部元数据（EXIF/GPS），除非显式 withMetadata
  const pipeline = sharp(buf).rotate(); // rotate 按 EXIF 方向摆正后再剥离

  let mainBuf: Buffer;
  let mainMime: string;
  let ext: string;

  if (convertWebP) {
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

  // 缩略图与 blurhash 并行处理（互不依赖）
  const thumbTask =
    mime === "image/gif"
      ? sharp(buf, { animated: false }).resize({ width: 400, withoutEnlargement: true }).webp().toBuffer()
      : sharp(mainBuf).resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).webp().toBuffer();
  const blurTask = (async (): Promise<string | null> => {
    try {
      // blurhash 占位图（小尺寸采样）
      const { data, info } = await sharp(mainBuf)
        .resize(32, 32, { fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
    } catch {
      return null; // blurhash 失败不阻塞上传
    }
  })();
  const [thumbBuf, blurhash] = await Promise.all([thumbTask, blurTask]);

  // 按站点设置的存储位置写入（新上传都进当前目标），并记录位置到 Image.storage（local 或 r2:<桶下标>）
  const marker = await getUploadMarker();
  const storage = await getStorageFor(marker);
  const rand = randomBytes(4).toString("hex");
  const storageKey = `images/${userId}/${monthKey()}/${sha256.slice(0, 16)}-${rand}.${ext}`;
  const thumbKey = `thumbs/${userId}/${monthKey()}/${sha256.slice(0, 16)}-${rand}.webp`;

  // 原图与缩略图并行写入
  await Promise.all([
    storage.put(storageKey, mainBuf, { contentType: mainMime }),
    storage.put(thumbKey, thumbBuf, { contentType: "image/webp" }),
  ]);

  return {
    filename: sanitizeName(originalName),
    storageKey,
    thumbKey,
    storage: marker,
    mimeType: mainMime,
    size: mainBuf.length,
    width,
    height,
    sha256,
    blurhash,
  };
}

/**
 * 视频存储：不做转码/缩略图（无 ffmpeg），按原始字节存盘。
 * thumbKey 置空（前端用 <video preload="metadata"> 取首帧），宽高 0，无 blurhash。
 */
export async function processAndStoreVideo(
  buf: Buffer,
  userId: string,
  originalName: string
): Promise<ProcessedUpload> {
  const mime = detectVideoMime(buf);
  if (!mime) throw new AppError("不支持的视频格式（仅允许 mp4/webm/mov/mkv）", 415);

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const marker = await getUploadMarker();
  const storage = await getStorageFor(marker);
  const rand = randomBytes(4).toString("hex");
  const ext = ALLOWED_VIDEO_MIMES[mime];
  const storageKey = `videos/${userId}/${monthKey()}/${sha256.slice(0, 16)}-${rand}.${ext}`;
  await storage.put(storageKey, buf, { contentType: mime });

  return {
    filename: sanitizeName(originalName),
    storageKey,
    thumbKey: "",
    storage: marker,
    mimeType: mime,
    size: buf.length,
    width: 0,
    height: 0,
    sha256,
    blurhash: null,
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
  // 头像固定存本地磁盘（体积小，不参与 R2 迁移，读取无需按记录区分驱动）
  await (await getLocalStorage()).put(key, out, { contentType: "image/webp" });
  return key;
}
