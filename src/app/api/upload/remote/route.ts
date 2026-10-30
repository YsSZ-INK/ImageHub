import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { uploadImages, assertAlbumAccess } from "@/server/image.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// URL 远程抓取：服务端拉取 → 同一校验/处理流水线（SSRF 基础防护）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();

  const rl = await rateLimit(`remote:${user.id}`, 10, 60_000);
  if (!rl.success) throw new AppError("抓取过于频繁", 429);

  const { url, albumId } = (await req.json()) as { url?: string; albumId?: string };
  if (!url || !/^https?:\/\//i.test(url)) throw new AppError("URL 不合法", 400);
  await assertAlbumAccess(user, albumId ?? null);

  // 禁止访问内网地址
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("URL 不合法", 400);
  }
  const host = parsed.hostname;
  if (
    /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new AppError("不允许抓取内网地址", 400);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "ImageHubBot/1.0" },
    });
  } catch {
    throw new AppError("抓取失败：无法访问目标地址", 502);
  }
  if (!res.ok) throw new AppError(`抓取失败：目标返回 ${res.status}`, 502);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/"))
    throw new AppError("目标不是图片或视频", 415);

  const arr = await res.arrayBuffer();
  if (arr.byteLength > 50 * 1024 * 1024) throw new AppError("远程文件过大（上限 50MB）", 413);

  const name = decodeURIComponent(parsed.pathname.split("/").pop() || "remote-file");
  const { results } = await uploadImages(user, [{ buf: Buffer.from(arr), name, contentType }], { albumId: albumId ?? null });
  const first = results[0];
  if (!first || "error" in first) throw new AppError("error" in first ? first.error : "抓取失败", 400);
  return ok(first, 201);
});
