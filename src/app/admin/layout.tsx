import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { SiteHeader } from "@/components/site-header";
import { SideNav } from "@/components/side-nav";
import { InkBackdrop, InkSeal } from "@/components/ink-theme";

// icon 为字符串名，由 SideNav 客户端组件映射（图标组件不能跨 RSC 边界传递）
const NAV = [
  { href: "/admin", label: "统计面板", icon: "bar-chart-3" },
  { href: "/admin/users", label: "用户管理", icon: "users" },
  { href: "/admin/images", label: "图片审核", icon: "images" },
  { href: "/admin/settings", label: "站点设置", icon: "settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const settings = await getSettings();

  return (
    <>
      <InkBackdrop />
      <SiteHeader siteName={settings.siteName} user={{ name: user.name, role: user.role, avatarUrl: user.avatarUrl }} />
      <div className="mx-auto flex max-w-7xl gap-8 p-4 md:px-8 md:py-8">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col overflow-y-auto rounded-2xl border border-foreground/10 bg-background/55 p-3 backdrop-blur-md">
            {/* 侧栏头部：印章 + 区块标识 */}
            <div className="mb-2 flex items-center gap-2.5 border-b border-foreground/10 px-2 pb-3">
              <InkSeal char="管" />
              <div className="leading-tight">
                <div className="text-sm font-semibold">管理后台</div>
                <div className="text-xs text-muted-foreground">画境司南 · 诸像有主</div>
              </div>
            </div>
            <div className="flex-1">
              <SideNav items={NAV} />
            </div>
            <div className="mt-3 border-t border-foreground/10 px-3 pt-3 text-[11px] leading-relaxed text-muted-foreground/70">
              秉笔直书，图不外流
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
