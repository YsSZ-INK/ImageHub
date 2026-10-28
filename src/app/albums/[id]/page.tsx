import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getAlbumForView, listImages } from "@/server/image.service";
import { getSettings } from "@/lib/settings";
import { SiteHeader } from "@/components/site-header";
import { GalleryView } from "@/components/gallery-view";
import { EmptyState } from "@/components/image-grid";

// 相册页：仅登录用户可见
export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireUser();
  const { id } = await params;
  const settings = await getSettings();

  try {
    const album = await getAlbumForView(id, viewer);
    const { items, nextCursor } = await listImages({
      viewer,
      scope: "album",
      albumId: album.id,
    });

    return (
      <>
        <SiteHeader siteName={settings.siteName} user={{ name: viewer.name, role: viewer.role, avatarUrl: viewer.avatarUrl }} />
        <main className="mx-auto max-w-7xl space-y-4 p-4">
          <div>
            <h1 className="text-xl font-bold">{album.name}</h1>
            {album.description && <p className="mt-1 text-sm text-muted-foreground">{album.description}</p>}
          </div>
          {items.length === 0 ? (
            <EmptyState title="相册里还没有图片" description="在「我的图片」中批量选择图片并移动到该相册" />
          ) : (
            <GalleryView initialItems={items} initialCursor={nextCursor} query={{ scope: "album", albumId: album.id }} />
          )}
        </main>
      </>
    );
  } catch {
    notFound();
  }
}
