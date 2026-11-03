import { handle, AppError } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { getStorageFor } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

const PREVIEW_MAX = 12 * 1024 * 1024;

// 桶内多余文件预览（仅超级管理员）：这些对象网站上已无记录，无法走图片接口，
// 这里按「槽位 + 对象名」直接从桶内读取，供核对时肉眼确认后再决定删除。
// 只放行 images/ 与 videos/ 前缀下的图片扩展名，避免变成任意对象读取通道。
export const GET = handle(async (req: Request) => {
  await requireApiSuper();
  const sp = new URL(req.url).searchParams;
  const slot = sp.get("slot") ?? "";
  const key = sp.get("key") ?? "";
  if (!/^r2:\d+$/.test(slot)) throw new AppError("无效的存储位置", 400);
  if (!/^(images|videos)\/[A-Za-z0-9._/-]+$/.test(key) || key.includes("..")) {
    throw new AppError("无效的对象名", 400);
  }
  const ext = (key.split(".").pop() ?? "").toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new AppError("该文件不支持预览", 400);

  const storage = await getStorageFor(slot);
  const buf = await storage.get(key);
  if (buf.length > PREVIEW_MAX) throw new AppError("文件过大，暂不提供预览", 413);
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": mime, "Cache-Control": "private, max-age=60" },
  });
});
