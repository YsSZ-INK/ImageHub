"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Eye, Clock, ShieldCheck, UserCheck, Send, Search, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarFallbackIcon } from "@/components/avatar";
import type { UserDirectoryEntry } from "@/server/access.service";

// 用户目录：按与我的授权关系渲染操作按钮，申请发出后走 router.refresh 让服务端重取关系
// hideViewable：隐藏已授权可查看的用户（交换图片页顶部切换条已展示，避免重复）
export function UsersDirectory({ users, hideViewable = false }: { users: UserDirectoryEntry[]; hideViewable?: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const base = hideViewable ? users.filter((u) => u.relation !== "canViewThem") : users;
  const q = query.trim().toLowerCase();
  const list = q ? base.filter((u) => u.name.toLowerCase().includes(q)) : base;

  async function request(user: UserDirectoryEntry) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/access-request`, { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        toast.success(`已向 ${user.name} 发起申请，等待对方审批`);
        router.refresh();
      } else toast.error(json.error);
    } catch {
      toast.error("网络错误，请稍后再试");
    } finally {
      setBusyId(null);
    }
  }

  if (base.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">站内还没有其他用户</p>;
  }

  return (
    <div>
      {/* 搜索用户名（本地过滤，输入即筛选） */}
      <div className="relative mb-3 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索用户名"
          className="h-9 pl-8"
          aria-label="搜索用户名"
        />
      </div>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-10 text-sm text-muted-foreground">
          <UserX className="h-5 w-5" />
          没有匹配「{query.trim()}」的用户
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((u) => (
        <div
          key={u.id}
          className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/55 p-4 backdrop-blur-sm"
        >
          <AvatarFallbackIcon name={u.name} url={u.avatarUrl} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{u.name}</p>
            <p className="text-xs text-muted-foreground">{RELATION_TEXT[u.relation]}</p>
          </div>
          <div className="shrink-0">
            {u.relation === "none" && (
              <Button size="sm" onClick={() => request(u)} disabled={busyId === u.id}>
                {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} 申请查看
              </Button>
            )}
            {u.relation === "pendingFromMe" && (
              <Button size="sm" variant="outline" disabled>
                <Clock className="h-3.5 w-3.5" /> 审批中
              </Button>
            )}
            {u.relation === "pendingToMe" && (
              <Button size="sm" variant="secondary" asChild>
                <Link href="/settings">
                  <ShieldCheck className="h-3.5 w-3.5" /> 待我审批
                </Link>
              </Button>
            )}
            {u.relation === "canViewThem" && (
              <Button size="sm" variant="secondary" asChild>
                <Link href={`/users/${u.name}`}>
                  <Eye className="h-3.5 w-3.5" /> 查看图片
                </Link>
              </Button>
            )}
            {u.relation === "grantedToMe" && (
              <Button size="sm" variant="ghost" disabled>
                <UserCheck className="h-3.5 w-3.5" /> 已授权对方
              </Button>
            )}
          </div>
        </div>
      ))}
        </div>
      )}
    </div>
  );
}

const RELATION_TEXT: Record<UserDirectoryEntry["relation"], string> = {
  none: "尚无授权关系",
  pendingFromMe: "你已申请，等待对方审批",
  pendingToMe: "对方申请查看你的图片",
  canViewThem: "你已获准浏览 TA 的图片",
  grantedToMe: "你已授权 TA 浏览你的图片",
};
