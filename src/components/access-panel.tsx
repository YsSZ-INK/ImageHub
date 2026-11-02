"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, Undo2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AvatarFallbackIcon } from "@/components/avatar";
import { formatDate } from "@/lib/utils";
import type { AccessRequestDTO } from "@/server/access.service";

// 访问申请面板：审批收到的申请 / 撤销已授权
// 我发出的申请不再单独展示——用户目录卡片上的「审批中 + 取消申请」已覆盖
// embedded：嵌在弹窗里时只渲染内容，去掉自带卡片外壳与标题
// 自带搜索框：按用户名过滤待审批 / 已处理列表，方便搜到指定用户直接审批
export function AccessPanel({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<{ received: AccessRequestDTO[]; sent: AccessRequestDTO[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/access/requests");
    const json = await res.json();
    if (json.ok) setData(json.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(id: string, action: "approve" | "reject" | "revoke") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/access/requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(action === "approve" ? "已同意，对方现在可以浏览你的图片" : action === "reject" ? "已拒绝" : "已撤销授权");
        await load();
      } else toast.error(json.error);
    } catch {
      toast.error("网络错误，请稍后再试");
    } finally {
      setBusyId(null);
    }
  }

  const q = query.trim().toLowerCase();
  const match = (r: AccessRequestDTO) => !q || r.user.name.toLowerCase().includes(q);
  const pending = data?.received.filter((r) => r.status === "PENDING" && match(r)) ?? [];
  const receivedOthers = data?.received.filter((r) => r.status !== "PENDING" && match(r)) ?? [];

  const body = (
      <div className="space-y-5">
        {/* 搜索用户名：过滤下方三块列表（与用户目录搜索框同款样式） */}
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索用户名"
            className="h-9 rounded-xl pl-8 focus-visible:ring-1 focus-visible:ring-foreground/20"
            aria-label="搜索用户名"
          />
        </div>

        {/* 待我审批 */}
        <section className="space-y-2.5">
          <h3 className="flex items-center gap-2 text-base">
            待我审批
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              {pending.length}
            </span>
          </h3>
          {data === null ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : pending.length === 0 ? (
            <p className="text-xs text-muted-foreground">{q ? `没有匹配「${query.trim()}」的待审批申请` : "暂无待审批申请"}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {pending.map((r) => (
                <RequestRow key={r.id} r={r} busy={busyId === r.id} onRespond={respond} />
              ))}
            </div>
          )}
        </section>

        {/* 已处理的历史（我收到的） */}
        {receivedOthers.length > 0 && (
          <section className="space-y-2.5">
            <h3 className="text-base">已处理（我收到的）</h3>
            {receivedOthers.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/55 p-3">
                <AvatarFallbackIcon name={r.user.name} url={r.user.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{r.user.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.createdAt)} 申请{r.respondedAt ? ` · ${formatDate(r.respondedAt)} 处理` : ""}
                  </p>
                </div>
                <StatusBadge status={r.status} />
                {/* 我授权过的人可以随时撤销：撤销后 TA 无法再浏览我的图片 */}
                {r.status === "APPROVED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === r.id}
                    onClick={() => {
                      if (confirm(`撤销后 ${r.user.name} 将无法再浏览你的图片，确定撤销？`)) respond(r.id, "revoke");
                    }}
                  >
                    <Undo2 className="h-3.5 w-3.5" /> 撤销授权
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
  );

  // 嵌在弹窗里：只给内容，标题由弹窗提供
  if (embedded) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">访问申请</CardTitle>
        <CardDescription>其他用户申请浏览你的图片时在这里审批；同意后 TA 可浏览你全部已发布的图片（含私密），可随时撤销授权。</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function RequestRow({
  r,
  busy,
  onRespond,
}: {
  r: AccessRequestDTO;
  busy: boolean;
  onRespond: (id: string, action: "approve" | "reject" | "revoke") => void;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-foreground/10 bg-background/55 p-4 backdrop-blur-sm">
      <AvatarFallbackIcon name={r.user.name} url={r.user.avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate">{r.user.name}</p>
        <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)} 申请查看你的图片</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" className="rounded-xl" disabled={busy} onClick={() => onRespond(r.id, "approve")}>
          <Check className="h-3.5 w-3.5" /> 同意
        </Button>
        <Button size="sm" variant="outline" className="rounded-xl" disabled={busy} onClick={() => onRespond(r.id, "reject")}>
          <X className="h-3.5 w-3.5" /> 拒绝
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    PENDING: { text: "待审批", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    APPROVED: { text: "已授权", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    REJECTED: { text: "已拒绝", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
  };
  const s = map[status] ?? { text: status, cls: "bg-muted text-muted-foreground" };
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}
