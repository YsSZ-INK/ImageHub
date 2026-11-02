"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Eye, ShieldCheck, Send, Search, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarFallbackIcon } from "@/components/avatar";
import type { UserDirectoryEntry } from "@/server/access.service";

// 用户目录：按与我的授权关系渲染操作按钮，申请发出后走 router.refresh 让服务端重取关系
// hideViewable：隐藏已授权可查看的用户（交换图片页顶部切换条已展示，避免重复）
// query：由外部传入搜索词时使用外部搜索框（弹窗顶部统一一个搜索框），自身不再渲染搜索框
export function UsersDirectory({
  users,
  hideViewable = false,
  query: externalQuery,
}: {
  users: UserDirectoryEntry[];
  hideViewable?: boolean;
  query?: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [internalQuery, setInternalQuery] = useState("");
  const controlled = externalQuery !== undefined;
  const query = controlled ? externalQuery : internalQuery;
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

  // 取消自己待审批的申请：删除记录后可重新发起
  async function cancelRequest(u: UserDirectoryEntry) {
    if (!u.requestId) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/access/requests/${u.requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已取消申请");
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
      {/* 搜索用户名（本地过滤，输入即筛选）；外部传入 query 时由调用方统一渲染搜索框 */}
      {!controlled && (
        <div className="relative mb-3 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setInternalQuery(e.target.value)}
            placeholder="搜索用户名"
            className="h-9 rounded-xl pl-8 focus-visible:ring-1 focus-visible:ring-foreground/20"
            aria-label="搜索用户名"
          />
        </div>
      )}
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-10 text-sm text-muted-foreground">
          <UserX className="h-5 w-5" />
          没有匹配「{query.trim()}」的用户
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((u) => (
        <div
          key={u.id}
          className="flex items-center gap-3.5 rounded-2xl border border-foreground/10 bg-background/55 p-4 backdrop-blur-sm"
        >
          <AvatarFallbackIcon name={u.name} url={u.avatarUrl} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate">{u.name}</p>
            <p className="text-xs text-muted-foreground">{RELATION_TEXT[u.relation]}</p>
          </div>
          <div className="shrink-0">
            {u.relation === "none" && (
              <Button size="sm" className="rounded-xl" onClick={() => request(u)} disabled={busyId === u.id}>
                {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} 申请查看
              </Button>
            )}
            {u.relation === "pendingFromMe" && (
              // 已发出待审批：卡片上直接取消，替代原「我发出的申请」列表
              <>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">审批中</span>
                <Button size="sm" className="rounded-xl" variant="outline" onClick={() => cancelRequest(u)} disabled={busyId === u.id || !u.requestId}>
                  {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} 取消申请
                </Button>
              </>
            )}
            {u.relation === "pendingToMe" && (
              <Button size="sm" className="rounded-xl" variant="secondary" asChild>
                <Link href="/settings">
                  <ShieldCheck className="h-3.5 w-3.5" /> 待我审批
                </Link>
              </Button>
            )}
            {u.relation === "canViewThem" && (
              <Button size="sm" className="rounded-xl" variant="secondary" asChild>
                <Link href={`/users/${u.name}`}>
                  <Eye className="h-3.5 w-3.5" /> 查看图片
                </Link>
              </Button>
            )}
            {u.relation === "grantedToMe" && (
              // 单向授权 ≠ 互看：已授权对方后，仍可反向申请查看 TA 的图片
              <Button size="sm" className="rounded-xl" variant="outline" onClick={() => request(u)} disabled={busyId === u.id}>
                {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} 申请互看
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
  grantedToMe: "你已授权对方查看你的图片",
};
