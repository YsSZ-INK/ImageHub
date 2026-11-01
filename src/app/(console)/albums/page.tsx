import { requireUser } from "@/lib/session";
import { AlbumsClient } from "@/components/albums-client";

export const dynamic = "force-dynamic";

// 相册管理：管理员可见全部人的相册；页面置顶固定「日常记录」虚拟相册入口
export default async function AlbumsPage() {
  const user = await requireUser();
  return <AlbumsClient isAdmin={user.role === "ADMIN"} />;
}
