import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { slotConfigured, slotDisplayName } from "@/lib/markers";
import { prisma } from "@/lib/db";
import { ConsoleTopBar, type NavGroup } from "@/components/console-topbar";
import { SideNav } from "@/components/side-nav";
import { StorageCards, type StorageCardsSnapshot } from "@/components/storage-cards";
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
    { href: "/admin/migrate", label: "存储迁移", icon: "upload" },
    { href: "/admin/settings", label: "站点设置", icon: "settings" },
  ],
};

/** 登录区通用外壳：深色顶栏 + 通栏分组侧栏（底部容量）+ 内容区；管理员在所有页面都显示「系统」分组 */
export async function ConsoleShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();

  // 每个配置完整的 R2 桶槽位，底部各显示一张站点级存储用量卡片（R2 弹性容量，只显示已用）
  const r2Slots = settings.r2Slots
    .map((cfg, i) => ({ cfg, i }))
    .filter(({ cfg }) => cfg.accessKeyId && cfg.bucket && slotConfigured(cfg));
  // 本地磁盘上的图片文件占用（迁移到 R2 后会减少；头像不含在内）
  const localAgg = await prisma.image.aggregate({ _sum: { size: true }, _count: true, where: { storage: "local" } });
  const r2Aggs = r2Slots.length
    ? await Promise.all(
        r2Slots.map(({ i }) => prisma.image.aggregate({ _sum: { size: true }, _count: true, where: { storage: `r2:${i}` } }))
      )
    : [];
  // 服务端渲染的初始快照；之后由 StorageCards 每 10 秒轮询局部刷新
  const initialSnap: StorageCardsSnapshot = {
    quota: Number(user.storageQuota),
    localUsed: Number(localAgg._sum.size ?? 0),
    localCount: localAgg._count,
    slots: r2Slots.map(({ cfg, i }, n) => ({
      marker: `r2:${i}`,
      label: slotDisplayName(cfg, i, settings.r2Slots.length),
      used: Number(r2Aggs[n]._sum.size ?? 0),
      count: r2Aggs[n]._count,
    })),
  };

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
                <div className="px-3 pb-1 text-[0.6875rem] font-medium tracking-widest text-muted-foreground/70">
                  {group.label}
                </div>
                <SideNav items={group.items} />
              </div>
            ))}
          </div>
          <div className="border-t border-foreground/10 p-3">
            {/* 存储卡片：初始服务端渲染，之后每 10 秒轮询局部刷新（迁移/上传后占用自动更新） */}
            <StorageCards initial={initialSnap} isAdmin={user.role === "ADMIN"} />
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
