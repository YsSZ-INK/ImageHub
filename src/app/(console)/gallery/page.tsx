import { requireUser } from "@/lib/session";
import { GalleryView } from "@/components/gallery-view";

// 公共画廊（仅登录可见）：展示所有用户的 PUBLIC 图片，支持排序
// 首屏不再在服务端查图片列表：这里只校验会话，页面框架立刻输出，
// 图片数据由客户端（GalleryView → useCursorPager）随后拉取，先进界面再慢慢出图
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  await requireUser();
  const { sort } = await searchParams;

  return (
    <GalleryView
      query={{ scope: "gallery", sort }}
      emptyTitle="画廊还是空的"
      emptyDescription="上传第一张图片，让它出现在这里"
      showOwner
    />
  );
}
