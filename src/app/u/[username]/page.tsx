import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { listImages, listAlbums } from "@/server/image.service";
import { getSettings } from "@/lib/settings";
import { SiteHeader } from "@/components/site-header";
import { GalleryView } from "@/components/gallery-view";
import { ImageGrid, EmptyState } from "@/components/image-grid";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Folder } from "lucide-react";

// 用户主页：该用户的公开图片与相册
export default async function UserPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const viewer = await requireUser();
  const { username } = await params;
  const settings = await getSettings();

  try {
    const [{ items, nextCursor }, albums] = await Promise.all([
      listImages({ viewer, scope: "user", username }),
      listAlbums(viewer, username),
    ]);

    return (
      <>
        <SiteHeader siteName={settings.siteName} user={{ name: viewer.name, role: viewer.role, avatarUrl: viewer.avatarUrl }} />
        <main className="mx-auto max-w-7xl space-y-6 p-4 xl:max-w-screen-2xl">
          <h1 className="text-xl font-bold">
            {username} 的公开图片
            <span className="ml-2 text-sm font-normal text-muted-foreground">{items.length} 张已加载</span>
          </h1>

          {albums.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">相册</h2>
              <div className="flex flex-wrap gap-3">
                {albums.map((a) => (
                  <Link
                    key={a.id}
                    href={`/albums/${a.id}`}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <Folder className="h-4 w-4" />
                    {a.name}
                    <span className="text-xs text-muted-foreground">{a.imageCount}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {items.length === 0 ? (
            <EmptyState title="暂无公开图片" />
          ) : (
            <GalleryView initialItems={items} initialCursor={nextCursor} query={{ scope: "user", username }} showOwner={false} />
          )}
        </main>
      </>
    );
  } catch {
    notFound();
  }
}
