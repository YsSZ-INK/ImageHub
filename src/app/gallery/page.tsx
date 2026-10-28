import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { requireUser } from "@/lib/session";
import { listImages } from "@/server/image.service";
import { listTags } from "@/server/image.service";
import { getSettings } from "@/lib/settings";
import { SiteHeader } from "@/components/site-header";
import { InkBackdrop, InkSeal } from "@/components/ink-theme";
import { GalleryView } from "@/components/gallery-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 公共画廊（仅登录可见）：展示所有用户的 PUBLIC 图片，支持标签筛选与排序
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; sort?: string }>;
}) {
  const user = await requireUser();
  const { tag, sort } = await searchParams;
  const settings = await getSettings();

  const [{ items, nextCursor }, tags] = await Promise.all([
    listImages({ viewer: user, scope: "gallery", tag, sort: (sort as "newest") ?? "newest" }),
    listTags(user),
  ]);

  return (
    <>
      <InkBackdrop />
      <SiteHeader siteName={settings.siteName} user={{ name: user.name, role: user.role, avatarUrl: user.avatarUrl }} />
      <main className="mx-auto max-w-7xl space-y-5 p-4 md:px-8 md:py-8">
        {/* 题款式页头 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <InkSeal char="览" className="h-9 w-9 text-sm" />
            <div className="leading-tight">
              <h1 className="text-2xl font-bold tracking-tight">公共画廊</h1>
              <p className="text-xs text-muted-foreground">烟云过眼 · 皆入此卷</p>
            </div>
          </div>
          <Button asChild>
            <Link href="/dashboard/upload">
              <UploadCloud className="h-4 w-4" />
              上传图片
            </Link>
          </Button>
        </div>

        {/* 标签筛选（毛玻璃条） */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-foreground/10 bg-background/55 p-2.5 backdrop-blur-sm">
            <Link href="/gallery">
              <Button variant={!tag ? "secondary" : "outline"} size="sm">
                全部
              </Button>
            </Link>
            {tags.map((t) => (
              <Link key={t.id} href={`/gallery?tag=${encodeURIComponent(t.name)}`}>
                <Button variant={tag === t.name ? "secondary" : "outline"} size="sm">
                  {t.name} <span className="ml-1 text-muted-foreground">{t.imageCount}</span>
                </Button>
              </Link>
            ))}
          </div>
        )}

        <GalleryView
          initialItems={items}
          initialCursor={nextCursor}
          query={{ scope: "gallery", tag, sort }}
          emptyTitle="画廊还是空的"
          emptyDescription="上传第一张图片，让它出现在这里"
          showOwner
        />
      </main>
    </>
  );
}
