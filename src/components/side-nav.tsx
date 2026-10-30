"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Images,
  Settings,
  LayoutDashboard,
  UploadCloud,
  Folder,
  Trash2,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

// 图标映射：服务端只能传字符串，客户端按名取图标（组件函数不能跨 RSC 边界传递）
const ICONS: Record<string, LucideIcon> = {
  users: Users,
  images: Images,
  settings: Settings,
  layout: LayoutDashboard,
  upload: UploadCloud,
  folder: Folder,
  trash: Trash2,
  news: Newspaper,
};

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

/** 侧栏导航：激活项竖墨条（书签批注样式）；horizontal 模式用于移动端顶部横向滚动导航（激活项底部墨点） */
export function SideNav({ items, horizontal = false }: { items: NavItem[]; horizontal?: boolean }) {
  const pathname = usePathname();

  if (horizontal) {
    return (
      <nav className="flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = ICONS[item.icon] ?? Images;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-display tracking-wide transition-colors ${
                active
                  ? "bg-foreground/[0.06] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {active && (
                <span className="absolute bottom-0 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-seal" />
              )}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = ICONS[item.icon] ?? Images;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-display tracking-wide transition-colors ${
              active
                ? "bg-foreground/[0.06] font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-seal" />
            )}
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
