"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Images, Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarFallbackIcon } from "@/components/avatar";

export type NavGroup = {
  label: string;
  items: { href: string; label: string; icon: string }[];
};

type Props = {
  siteName: string;
  user: { name: string; role: string; avatarUrl: string | null };
  navGroups: NavGroup[];
};

/** 深色顶栏：左站名 / 中当前页标题 / 右用户菜单（标题由路径在 navGroups 中匹配） */
export function ConsoleTopBar({ siteName, user, navGroups }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const flat = navGroups.flatMap((g) => g.items);
  const matched = flat.find((i) => i.href === pathname)
    ?? flat.filter((i) => pathname.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const title = matched?.label ?? "";

  async function logout() {
    await signOut({ redirect: false });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 bg-stone-900 text-stone-50">
      <div className="flex h-12 items-center justify-between px-4 md:px-6">
        <Link href="/gallery" className="flex items-center gap-2 font-bold">
          <Images className="h-5 w-5" />
          <span className="hidden font-display text-base tracking-wide sm:inline">{siteName}</span>
        </Link>
        <span className="absolute left-1/2 hidden -translate-x-1/2 text-sm font-medium tracking-wide sm:inline">
          {title}
        </span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-stone-50 hover:bg-stone-800 hover:text-stone-50">
                <AvatarFallbackIcon name={user.name} url={user.avatarUrl} size={24} />
                <span className="hidden max-w-28 truncate sm:inline">{user.name}</span>
                <Menu className="h-4 w-4 sm:hidden" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user.name}</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
