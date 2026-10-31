import { handle, ok, AppError } from "@/lib/api";
import { requireApiAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 迁移页图片列表：按存储位置分页列出（迁移管理页勾选要迁移的图片）
export const GET = handle(async (req: Request) => {
  await requireApiAdmin();
  const url = new URL(req.url);
  const marker = url.searchParams.get("marker") ?? "local";
  if (marker !== "local" && !/^r2:\d+$/.test(marker)) throw new AppError("无效的存储位置", 400);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const take = 30;

  const where = { storage: marker, deletedAt: null };
  const [total, rows] = await Promise.all([
    prisma.image.count({ where }),
    prisma.image.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * take,
      take,
      select: { id: true, filename: true, size: true, storage: true, mimeType: true, createdAt: true },
    }),
  ]);
  return ok({
    items: rows.map((r) => ({
      ...r,
      thumbUrl: `/api/images/${r.id}/thumb`,
      kind: r.mimeType.startsWith("video/") ? "video" : "image",
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / take)),
  });
});
