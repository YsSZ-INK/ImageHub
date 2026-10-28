"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Images, LayoutDashboard, Shield, User, LogOut, Menu } from "lucide-react";
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

type Props = {
  siteName: string;
  user: { name: string; role: string; avatarUrl: string | null };
};

export function SiteHeader({ siteName, user }: Props) {
  const router = useRouter();

  async function logout() {
    await signOut({ redirect: false });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-4">
          <Link href="/gallery" className="flex items-center gap-2 font-bold">
            <Images className="h-5 w-5" />
            <span className="hidden font-display text-lg tracking-wide sm:inline">{siteName}</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link href="/gallery">
              <Button variant="ghost" size="sm" className="font-display tracking-wide">
                公共画廊
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="font-display tracking-wide">
                <LayoutDashboard className="h-4 w-4" />
                我的图片
              </Button>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <AvatarFallbackIcon name={user.name} url={user.avatarUrl} size={24} />
                <span className="hidden sm:inline max-w-24 truncate">{user.name}</span>
                <Menu className="h-4 w-4 md:hidden" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user.name}</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
                <User className="mr-2 h-4 w-4" /> 个人中心
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/dashboard/upload")}>上传图片</DropdownMenuItem>
              {user.role === "ADMIN" && (
                <DropdownMenuItem onClick={() => router.push("/admin")}>管理后台</DropdownMenuItem>
              )}
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
