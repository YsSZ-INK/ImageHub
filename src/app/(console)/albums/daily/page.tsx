import { requireUser } from "@/lib/session";
import { DailyAlbumClient } from "@/components/daily-album-client";

export const dynamic = "force-dynamic";

// 日常记录（虚拟相册）：静态段优先于 /albums/[id]，"daily" 不会落入动态路由
export default async function DailyAlbumPage() {
  const user = await requireUser();
  return <DailyAlbumClient isAdmin={user.role === "ADMIN"} />;
}
