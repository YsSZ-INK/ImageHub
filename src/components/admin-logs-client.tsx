"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvatarFallbackIcon } from "@/components/avatar";
import { formatDate } from "@/lib/utils";

type LogDTO = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  user: { name: string; avatarUrl: string | null } | null;
};

// 动作类型 → 中文标签（仅作归类徽标，句子本身已可读）
const ACTION_LABEL: Record<string, string> = {
  register: "注册",
  login: "登录",
  upload: "上传",
  image_delete: "回收站",
  restore: "恢复",
  purge: "彻底删除",
  visibility: "可见性",
  album: "相册",
  post: "动态",
  post_delete: "动态",
  comment: "评论",
  comment_delete: "评论",
  access: "授权",
  admin_user: "用户管理",
  admin_review: "审核",
  settings: "站点设置",
  redis: "Redis",
};

const PAGE_SIZE = 10;

// 站点操作日志：普通用户也能看懂的记录（谁在什么时间做了什么）
// hideHeader：嵌入弹窗时隐藏卡片自带标题（外层弹窗已有标题），避免重复
export function AdminLogsClient({ hideHeader }: { hideHeader?: boolean }) {
  const [items, setItems] = useState<LogDTO[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/logs?page=${p}`);
      const json = await res.json();
      if (json.ok) {
        setItems(json.data.items);
        setTotal(json.data.total);
        setPage(json.data.page);
      } else toast.error(json.error);
    } catch {
      toast.error("网络错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      {!hideHeader && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" /> 操作日志
          </CardTitle>
          <CardDescription>站点关键操作的记录：谁在什么时间做了什么（保留最近记录）。</CardDescription>
        </CardHeader>
      )}
      <CardContent className="space-y-2">
        {items === null || loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">还没有日志</p>
        ) : (
          items.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-lg border border-foreground/10 p-2.5 text-sm">
              <span className="w-36 shrink-0 text-xs text-muted-foreground sm:w-40">{formatDate(l.createdAt)}</span>
              {l.user ? <AvatarFallbackIcon name={l.user.name} url={l.user.avatarUrl} size={28} /> : <span className="h-7 w-7 shrink-0" />}
              <span className="min-w-0 flex-1 break-all">{l.detail}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{ACTION_LABEL[l.action] ?? "其他"}</span>
            </div>
          ))
        )}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>
              <ChevronLeft className="h-4 w-4" /> 上一页
            </Button>
            <span className="text-muted-foreground">
              第 {page} / {pages} 页 · 共 {total} 条
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>
              下一页 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
