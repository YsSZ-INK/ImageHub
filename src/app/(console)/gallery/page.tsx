import { requireUser } from "@/lib/session";
import { listImages } from "@/server/image.service";
import { GalleryView } from "@/components/gallery-view";

// 公共画廊（仅登录可见）：展示所有用户的 PUBLIC 图片，支持排序
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const user = await requireUser();
  const { sort } = await searchParams;

  const { items, nextCursor } = await listImages({
    viewer: user,
    scope: "gallery",
    sort: (sort as "newest") ?? "newest",
    // 每页 60 张：2/4/6 列都能整除（30/15/10 行），避免最后一行留空位
    take: 60,
  });

  return (
    <GalleryView
      initialItems={items}
      initialCursor={nextCursor}
      query={{ scope: "gallery", sort }}
      emptyTitle="画廊还是空的"
      emptyDescription="上传第一张图片，让它出现在这里"
      showOwner
    />
  );
}
