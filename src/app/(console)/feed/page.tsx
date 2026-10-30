import { requireUser } from "@/lib/session";
import { FeedClient } from "@/components/feed-client";

export const dynamic = "force-dynamic";

// 图文动态（朋友圈式 feed）
export default async function FeedPage() {
  const user = await requireUser();
  return <FeedClient me={{ name: user.name, avatarUrl: user.avatarUrl }} />;
}
