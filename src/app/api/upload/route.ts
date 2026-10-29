import { NextResponse } from "next/server";
import { handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { getSettings, envMaxUploadMB } from "@/lib/settings";
import { uploadImages, attachTagsByName } from "@/server/image.service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 上传：multipart，多文件并发（服务端串行处理防 OOM），限流 + MIME/魔数校验 + 配额
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();

  const rl = await rateLimit(`upload:${user.id}`, 60, 60_000);
  if (!rl.success) throw new AppError("上传过于频繁，请稍后再试", 429);

  const settings = await getSettings();
  const maxMB = Math.min(settings.maxUploadMB, envMaxUploadMB() || settings.maxUploadMB);
  const maxBytes = maxMB * 1024 * 1024;

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new AppError("缺少文件", 400);
  if (files.length > 20) throw new AppError("单次最多上传 20 个文件", 400);

  // 自定义标签：逗号/中文逗号分隔（服务端再清洗一次：去重、限 10 个、单个 ≤30 字）
  const tags = String(form.get("tags") ?? "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  const payloads: { buf: Buffer; name: string; contentType: string }[] = [];
  for (const f of files) {
    if (f.size > maxBytes) throw new AppError(`文件 ${f.name} 超过大小上限 ${maxMB}MB`, 413);
    // 不依赖浏览器声明的 MIME（拖拽文件可能为空或非标准值），统一交给魔数校验
    const buf = Buffer.from(await f.arrayBuffer());
    payloads.push({ buf, name: f.name || "image", contentType: f.type });
  }

  const { results } = await uploadImages(user, payloads);
  // 上传成功项自动关联自定义标签
  const okIds = results.filter((r) => !("error" in r)).map((r) => (r as { id: string }).id);
  if (tags.length > 0 && okIds.length > 0) await attachTagsByName(user.id, okIds, tags);
  const successCount = results.filter((r) => !("error" in r)).length;
  return NextResponse.json({ ok: true, data: { results, successCount } }, { status: successCount > 0 ? 201 : 400 });
});
