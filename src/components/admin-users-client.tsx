"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Ban, ShieldCheck, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatBytes, shortDate } from "@/lib/utils";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  storageQuota: string;
  storageUsed: string;
  imageCount: number;
  createdAt: string;
};

// 用户管理：搜索、封禁/解封、调整角色与配额
export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      const json = await res.json();
      if (json.ok) setUsers(json.data);
      else toast.error(json.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(id: string, patch: Record<string, unknown>) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已更新");
        load(search);
      } else toast.error(json.error);
    } finally {
      setUpdating(null);
    }
  }

  function adjustQuota(u: AdminUser) {
    const gb = prompt(`调整 ${u.name} 的配额（GB），当前 ${(Number(u.storageQuota) / 1024 ** 3).toFixed(1)}GB`);
    if (!gb) return;
    const n = Number(gb);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("请输入合法数字");
      return;
    }
    update(u.id, { storageQuotaGB: n });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">用户管理</h1>
        <div className="flex gap-2">
          <Input
            placeholder="搜索邮箱 / 用户名"
            className="w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(search)}
          />
          <Button variant="outline" onClick={() => load(search)}>
            搜索
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2.5">用户</th>
                <th className="p-2.5">角色</th>
                <th className="p-2.5">状态</th>
                <th className="p-2.5">图片</th>
                <th className="p-2.5">存储</th>
                <th className="p-2.5">注册</th>
                <th className="p-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="p-2.5">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="p-2.5">
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
                  </td>
                  <td className="p-2.5">
                    <Badge variant={u.status === "ACTIVE" ? "outline" : "destructive"}>
                      {u.status === "ACTIVE" ? "正常" : "已封禁"}
                    </Badge>
                  </td>
                  <td className="p-2.5">{u.imageCount}</td>
                  <td className="p-2.5">
                    {formatBytes(u.storageUsed)} / {formatBytes(u.storageQuota)}
                  </td>
                  <td className="p-2.5 text-muted-foreground">{shortDate(u.createdAt)}</td>
                  <td className="p-2.5">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updating === u.id}
                        onClick={() => update(u.id, { status: u.status === "ACTIVE" ? "BANNED" : "ACTIVE" })}
                      >
                        {u.status === "ACTIVE" ? <Ban className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                        {u.status === "ACTIVE" ? "封禁" : "解封"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={updating === u.id} onClick={() => update(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" })}>
                        <Crown className="h-3 w-3" />
                        {u.role === "ADMIN" ? "降级" : "设管理员"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={updating === u.id} onClick={() => adjustQuota(u)}>
                        配额
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
