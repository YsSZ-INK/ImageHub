import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getImageDetail } from "@/server/image.service";
import { CopyField, VisibilityBadge } from "@/components/image-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/utils";

// 图片详情页（站内链接落地页）：登录 + 权限校验；外壳由 (console) 布局提供
export default async function ImageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireUser();
  const { id } = await params;

  let img;
  try {
    img = await getImageDetail(id, viewer);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <span className="max-w-md truncate">{img.filename}</span>
          <VisibilityBadge visibility={img.visibility} />
        </h1>
        <a
          href={`/api/images/${id}/download`}
          className="text-sm text-primary hover:underline"
        >
          下载{img.kind === "video" ? "视频" : "原图"}
        </a>
      </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex items-center justify-center rounded-xl border border-border bg-muted/20 p-2">
            {img.kind === "video" ? (
              <video src={img.rawUrl} controls playsInline className="max-h-[70vh] max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.rawUrl} alt={img.filename} className="max-h-[70vh] max-w-full object-contain" />
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {img.kind !== "video" && (
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">尺寸</span>
                    <span>{img.width} × {img.height}</span>
                  </p>
                )}
                <p className="flex justify-between">
                  <span className="text-muted-foreground">大小</span>
                  <span>{formatBytes(img.size)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">格式</span>
                  <span>{img.mimeType}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">上传时间</span>
                  <span>{formatDate(img.createdAt)}</span>
                </p>
                {img.ownerName && (
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">上传者</span>
                    <span>{img.ownerName}</span>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">复制链接</CardTitle>
              </CardHeader>
              <CardContent>
                <CopyField imageId={img.id} filename={img.filename} />
              </CardContent>
            </Card>
          </div>
        </div>
    </div>
  );
}
