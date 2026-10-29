import { requireUser } from "@/lib/session";
import { listAlbums } from "@/server/image.service";
import { MyImagesClient } from "@/components/my-images-client";

// 我的图片
export default async function DashboardPage() {
  const user = await requireUser();
  const albums = await listAlbums(user);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">我的图片</h1>
      <MyImagesClient
        albums={albums.map((a) => ({ id: a.id, name: a.name }))}
      />
    </div>
  );
}
