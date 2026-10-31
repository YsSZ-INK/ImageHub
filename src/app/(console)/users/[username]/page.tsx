import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { hasAccessTo } from "@/server/access.service";
import { listImages } from "@/server/image.service";
import { GalleryView } from "@/components/gallery-view";
import { EmptyState } from "@/components/image-grid";
import { Button } from "@/components/ui/button";
import { AvatarFallbackIcon } from "@/components/avatar";

// 浏览其他用户的图片：已获授权（申请-审批通过）才可见其全部已发布图片（含 PRIVATE）
export default async function UserImagesPage({ params }: { params: Promise<{ username: string }> }) {
  const viewer = await requireUser();
  const { username } = await params;
  const target = await prisma.user.findUnique({
    where: { name: decodeURIComponent(username) },
    select: { id: true, name: true, avatarUrl: true, status: true },
  });
  if (!target || target.status !== "ACTIVE") notFound();
  if (target.id === viewer.id) redirect("/images");

  const granted = viewer.role === "ADMIN" || (await hasAccessTo(viewer.id, target.id));
  if (!granted) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">{target.name} 的图片</h1>
        <EmptyState
          title="尚未获得授权"
          description={`你需要向 ${target.name} 发起申请，待对方同意后即可浏览 TA 的已发布图片。`}
          action={
            <Button asChild>
              <Link href="/users">前往用户目录申请</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { items, nextCursor } = await listImages({
    viewer,
    scope: "user",
    username: target.name,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AvatarFallbackIcon name={target.name} url={target.avatarUrl} size={40} />
        <h1 className="text-xl font-bold">{target.name} 的图片</h1>
      </div>
      <GalleryView
        initialItems={items}
        initialCursor={nextCursor}
        query={{ scope: "user", username: target.name }}
        emptyTitle="TA 还没有已发布的图片"
      />
    </div>
  );
}
