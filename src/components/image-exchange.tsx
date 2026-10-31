"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { ImageGrid, EmptyState, GridSkeleton } from "@/components/image-grid";
import { Pager } from "@/components/pager";
import { UsersDirectory } from "@/components/users-directory";
import { AvatarFallbackIcon } from "@/components/avatar";
import { useCursorPager } from "@/lib/use-cursor-pager";
import type { ImageDTO } from "@/server/image.service";
import type { UserDirectoryEntry } from "@/server/access.service";

/**
 * 交换图片页：已授权用户横向切换条 + 页内浏览对方图片（无需跳转），
 * 下方折叠「申请与更多用户」目录。
 */
export function ExchangeView({
  users,
  initialUser,
  initialItems,
  initialCursor,
}: {
  users: UserDirectoryEntry[];
  initialUser: UserDirectoryEntry | null;
  initialItems: ImageDTO[];
  initialCursor: string | null;
}) {
  const [active, setActive] = useState<UserDirectoryEntry | null>(initialUser);
  const [showMore, setShowMore] = useState(false);
  const viewable = users.filter((u) => u.relation === "canViewThem");
  const pendingToMe = users.filter((u) => u.relation === "pendingToMe").length;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">交换图片</h1>

      {/* 待我审批提醒 */}
      {pendingToMe > 0 && (
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-400"
        >
          <ShieldCheck className="h-4 w-4 shrink-0" />
          有 {pendingToMe} 位用户申请查看你的图片，点击前往个人中心审批
        </Link>
      )}

      {/* 可切换的用户条 */}
      {viewable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {viewable.map((u) => (
            <button
              key={u.id}
              onClick={() => setActive(u)}
              className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors ${
                active?.id === u.id
                  ? "border-seal/50 bg-seal/10 font-medium"
                  : "border-foreground/10 bg-background/55 hover:border-foreground/25"
              }`}
            >
              <AvatarFallbackIcon name={u.name} url={u.avatarUrl} size={26} />
              {u.name}
            </button>
          ))}
        </div>
      )}

      {/* 当前用户的图片 */}
      {active ? (
        <UserPane
          key={active.id}
          username={active.name}
          initialItems={active.id === initialUser?.id ? initialItems : undefined}
          initialCursor={active.id === initialUser?.id ? initialCursor : undefined}
        />
      ) : (
        <EmptyState
          title="还没有可交换的对象"
          description="在下方用户目录里向 TA 申请查看图片，对方同意后这里会出现 TA 的名字，点击即可切换浏览。"
        />
      )}

      {/* 申请与更多用户（折叠） */}
      {users.length > 0 && (
        <div className="rounded-xl border border-foreground/10 bg-background/55 backdrop-blur-sm">
          <button
            onClick={() => setShowMore((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
          >
            {active ? "申请查看更多用户的图片" : "用户目录 · 发起申请"}
            <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`} />
          </button>
          {showMore && (
            <div className="border-t border-foreground/10 p-3">
              <UsersDirectory users={users} hideViewable />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 单个用户的图片面板：切换用户时按 key 重挂载，游标栈随之重置
function UserPane({
  username,
  initialItems,
  initialCursor,
}: {
  username: string;
  initialItems?: ImageDTO[];
  initialCursor?: string | null;
}) {
  const { items, page, hasNext, loading, gotoPage } = useCursorPager(
    { scope: "user", username },
    { initialItems, initialCursor }
  );

  if (loading && items.length === 0) return <GridSkeleton />;
  if (items.length === 0) {
    return <EmptyState title={`${username} 还没有已发布的图片`} />;
  }

  return (
    <div className="space-y-3">
      <ImageGrid items={items} />
      <Pager page={page} hasNext={hasNext} disabled={loading} onGo={gotoPage} />
    </div>
  );
}
