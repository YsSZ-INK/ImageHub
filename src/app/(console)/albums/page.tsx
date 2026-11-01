import { requireUser } from "@/lib/session";
import { isAdminRole } from "@/lib/roles";
import { AlbumsClient } from "@/components/albums-client";

export const dynamic = "force-dynamic";

// 相册管理：超级管理员可见全部人的相册；页面置顶固定「日常记录」虚拟相册入口（两级管理员可见）
export default async function AlbumsPage() {
  const user = await requireUser();
  return <AlbumsClient isAdmin={isAdminRole(user.role)} />;
}
