import { requireUser } from "@/lib/session";
import { listAlbums, listTags } from "@/server/image.service";
import { MyImagesClient } from "@/components/my-images-client";

// 我的图片
export default async function DashboardPage() {
  const user = await requireUser();
  const [albums, tags] = await Promise.all([
    listAlbums(user),
    listTags(user),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">我的图片</h1>
      <MyImagesClient
        albums={albums.map((a) => ({ id: a.id, name: a.name }))}
        tags={tags.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
