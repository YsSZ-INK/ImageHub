"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AvatarFallbackIcon } from "@/components/avatar";
import { formatDate } from "@/lib/utils";
import type { AccessRequestDTO } from "@/server/access.service";

// 个人中心「图片访问」面板：审批收到的申请 / 追踪我发出的申请 / 撤销已授权
export function AccessPanel() {
  const [data, setData] = useState<{ received: AccessRequestDTO[]; sent: AccessRequestDTO[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const pending = data?.received.filter((r) => r.status === "PENDING") ?? [];
  const receivedOthers = data?.received.filter((r) => r.status !== "PENDING") ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">图片访问</CardTitle>
        <CardDescription>其他用户申请浏览你的图片时在这里审批；同意后 TA 可浏览你全部已发布的图片（含私密）。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 待我审批 */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium">待我审批（{pending.length}）</h3>
          {data === null ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : pending.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无待审批申请</p>
          ) : (
            pending.map((r) => <RequestRow key={r.id} r={r} busy={busyId === r.id} onRespond={respond} />)
          )}
        </section>

        {/* 我发出的申请 */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium">我发出的申请</h3>
          {data === null ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : data.sent.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有发起过申请，可到
              <a href="/users" className="mx-1 text-primary hover:underline">
                用户目录
              </a>
              向其他用户申请查看图片
            </p>
          ) : (
            data.sent.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-foreground/10 p-2.5">
                <AvatarFallbackIcon name={r.user.name} url={r.user.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.user.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)} 申请</p>
                </div>
                <StatusBadge status={r.status} />
                {r.status === "APPROVED" && (
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => respond(r.id, "revoke")}>
                    <Undo2 className="h-3.5 w-3.5" /> 撤销
                  </Button>
                )}
              </div>
            ))
          )}
        </section>

        {/* 已处理的历史（我收到的） */}
        {receivedOthers.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">已处理（我收到的）</h3>
            {receivedOthers.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-foreground/10 p-2.5">
                <AvatarFallbackIcon name={r.user.name} url={r.user.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.user.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.createdAt)} 申请{r.respondedAt ? ` · ${formatDate(r.respondedAt)} 处理` : ""}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </section>
        )}
      </CardContent>
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
    <div className="flex items-center gap-3 rounded-lg border border-foreground/10 p-2.5">
      <AvatarFallbackIcon name={r.user.name} url={r.user.avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{r.user.name}</p>
        <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)} 申请查看你的图片</p>
      </div>
      <Button size="sm" disabled={busy} onClick={() => onRespond(r.id, "approve")}>
        <Check className="h-3.5 w-3.5" /> 同意
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onRespond(r.id, "reject")}>
        <X className="h-3.5 w-3.5" /> 拒绝
      </Button>
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
