import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getAlbumForView, listImages } from "@/server/image.service";
import { getSettings } from "@/lib/settings";
import { SiteHeader } from "@/components/site-header";
import { AlbumDetailClient } from "@/components/album-detail-client";
import { GalleryView } from "@/components/gallery-view";
import { EmptyState } from "@/components/image-grid";

// 相册页：登录用户可见；拥有者可管理（移出/封面/删除/编辑），他人只读
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
    const isOwner = album.userId === viewer.id || viewer.role === "ADMIN";

    return (
      <>
        <SiteHeader siteName={settings.siteName} user={{ name: viewer.name, role: viewer.role, avatarUrl: viewer.avatarUrl }} />
        <main className="mx-auto max-w-7xl space-y-4 p-4 xl:max-w-screen-2xl">
          {isOwner ? (
            <AlbumDetailClient
              album={{
                id: album.id,
                name: album.name,
                description: album.description,
                visibility: album.visibility,
                coverImageId: album.coverImageId,
                imageCount: album.imageCount,
              }}
              initialItems={items}
              initialCursor={nextCursor}
            />
          ) : (
            <>
              <div>
                <h1 className="text-xl font-bold">{album.name}</h1>
                {album.description && <p className="mt-1 text-sm text-muted-foreground">{album.description}</p>}
              </div>
              {items.length === 0 ? (
                <EmptyState title="相册里还没有图片" />
              ) : (
                <GalleryView initialItems={items} initialCursor={nextCursor} query={{ scope: "album", albumId: album.id }} />
              )}
            </>
          )}
        </main>
      </>
    );
  } catch {
    notFound();
  }
}
