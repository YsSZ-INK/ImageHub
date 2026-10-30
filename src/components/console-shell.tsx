import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { ConsoleTopBar, type NavGroup } from "@/components/console-topbar";
import { SideNav } from "@/components/side-nav";
import { QuotaBar } from "@/components/quota-bar";
import { InkBackdrop } from "@/components/ink-theme";

// icon 为字符串名，由 SideNav 客户端组件映射（图标组件不能跨 RSC 边界传递）
const MY_GROUPS: NavGroup[] = [
  {
    label: "我的",
    items: [
      { href: "/images", label: "我的图片", icon: "upload" },
      { href: "/albums", label: "相册管理", icon: "folder" },
      { href: "/trash", label: "回收站", icon: "trash" },
      { href: "/settings", label: "个人中心", icon: "settings" },
    ],
  },
  {
    label: "公共",
    items: [
      { href: "/gallery", label: "公共画廊", icon: "images" },
      { href: "/feed", label: "图文动态", icon: "news" },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  label: "系统",
  items: [
    { href: "/admin", label: "统计面板", icon: "layout" },
    { href: "/admin/users", label: "用户管理", icon: "users" },
    { href: "/admin/images", label: "图片审核", icon: "images" },
    { href: "/admin/settings", label: "站点设置", icon: "settings" },
  ],
};

/** 登录区通用外壳：深色顶栏 + 通栏分组侧栏（底部容量）+ 内容区；管理员在所有页面都显示「系统」分组 */
export async function ConsoleShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();

  const navGroups = user.role === "ADMIN" ? [...MY_GROUPS, ADMIN_GROUP] : MY_GROUPS;
  const flatItems = navGroups.flatMap((g) => g.items);

  return (
    <>
      <InkBackdrop />
      <ConsoleTopBar siteName={settings.siteName} user={{ name: user.name, role: user.role, avatarUrl: user.avatarUrl }} navGroups={navGroups} />
      <div className="flex">
        {/* 桌面侧栏：通栏贴边，分组导航 + 底部容量 */}
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-52 shrink-0 flex-col border-r border-foreground/10 bg-background/55 backdrop-blur-md md:flex">
          <div className="flex-1 space-y-4 overflow-y-auto p-3">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-1 text-[11px] font-medium tracking-widest text-muted-foreground/70">
                  {group.label}
                </div>
                <SideNav items={group.items} />
              </div>
            ))}
          </div>
          <div className="border-t border-foreground/10 p-3">
            <QuotaBar used={Number(user.storageUsed)} quota={Number(user.storageQuota)} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-7xl xl:max-w-screen-2xl">
            {/* 小屏导航：横向滚动条（桌面端显示侧栏） */}
            <div className="mb-4 rounded-xl border border-foreground/10 bg-background/55 p-2 backdrop-blur-md md:hidden">
              <SideNav items={flatItems} horizontal />
            </div>
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
