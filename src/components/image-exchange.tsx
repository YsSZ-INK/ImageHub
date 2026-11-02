"use client";

import { useState } from "react";
import { ImageGrid, EmptyState, GridSkeleton } from "@/components/image-grid";
import { Pager } from "@/components/pager";
import { UsersDirectory } from "@/components/users-directory";
import { AccessPanel } from "@/components/access-panel";
import { AvatarFallbackIcon } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCursorPager } from "@/lib/use-cursor-pager";
import type { ImageDTO } from "@/server/image.service";
import type { UserDirectoryEntry } from "@/server/access.service";

/**
 * 交换图片页：主区域展示已授权用户的图片（横向切换条 + 页内浏览）。
 * 右上角「申请与授权」一个按钮打开弹窗，内含两块内容，各自带同款搜索框——
 * 上方用户目录（向他人发起查看申请），下方我的申请记录（审批收到的 / 追踪我发出的 / 撤销授权）。
 */
export function ExchangeTabs({
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
  const [open, setOpen] = useState(false);
  const pendingToMe = users.filter((u) => u.relation === "pendingToMe").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">交换图片</h1>

        <Button variant="outline" className="gap-1.5 rounded-xl" onClick={() => setOpen(true)}>
          申请与授权
          {pendingToMe > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[0.625rem] font-bold leading-none text-white">
              {pendingToMe}
            </span>
          )}
        </Button>
      </div>

      <ExchangeView users={users} initialUser={initialUser} initialItems={initialItems} initialCursor={initialCursor} />

      {/* 申请与授权弹窗：上方用户目录（发起/取消申请），下方审批收到的申请与撤销授权，各自带同款搜索框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>申请与授权</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-5 overflow-y-auto">
            {/* 上半区：申请——向他人发起查看申请 */}
            <section className="space-y-2.5">
              <h3 className="text-base">申请</h3>
              <UsersDirectory users={users} hideViewable />
            </section>
            <div className="border-t border-foreground/10 pt-4">
              {/* 下半区：授权——审批别人的申请、追踪与撤销授权 */}
              <section className="space-y-2.5">
                <h3 className="text-base">授权</h3>
                <AccessPanel embedded />
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 默认浏览区：已授权用户切换条 + 当前用户图片
function ExchangeView({
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
  const viewable = users.filter((u) => u.relation === "canViewThem");

  return (
    <div className="space-y-4">
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
          description="点右上角「申请查看」向 TA 发起申请，对方同意后这里会出现 TA 的名字，点击即可切换浏览。"
        />
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
  const { items, page, hasNext, totalPages, loading, gotoPage } = useCursorPager(
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
      <Pager page={page} hasNext={hasNext} totalPages={totalPages} disabled={loading} onGo={gotoPage} />
    </div>
  );
}
