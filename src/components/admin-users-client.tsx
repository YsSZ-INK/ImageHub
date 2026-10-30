"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Ban, ShieldCheck, Crown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  // 添加用户表单
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "USER", quotaGB: "" });
  // 多选批量操作
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(users.map((u) => u.id)) : new Set());
  }

  // 批量封禁/解封（逐个调用 PATCH，失败的用户计数提示）
  async function batchStatus(status: "ACTIVE" | "BANNED") {
    // 批量封禁自动跳过管理员，避免把唯一管理员封禁导致后台失去管理能力
    const targets = users.filter((u) => selected.has(u.id) && !(status === "BANNED" && u.role === "ADMIN"));
    const skipped = selected.size - targets.length;
    if (targets.length === 0) {
      toast.error(skipped > 0 ? "所选均为管理员，批量封禁已跳过" : "请先选择用户");
      return;
    }
    if (status === "BANNED" && !confirm(`确定封禁选中的 ${targets.length} 个用户？${skipped > 0 ? `（${skipped} 个管理员已自动跳过）` : ""}`)) return;
    setUpdating("batch");
    try {
      const results = await Promise.allSettled(
        targets.map((u) =>
          fetch(`/api/admin/users/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }).then((r) => r.json())
        )
      );
      const okCount = results.filter((x) => x.status === "fulfilled" && x.value?.ok).length;
      if (okCount > 0) {
        toast.success(`已${status === "BANNED" ? "封禁" : "解封"} ${okCount} 个用户`);
        setSelected(new Set());
        load(search);
      } else toast.error("操作失败，请重试");
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

  async function createUser() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim(),
          password: form.password,
          role: form.role,
          ...(form.quotaGB ? { storageQuotaGB: Number(form.quotaGB) } : {}),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`用户 ${json.data.user.name} 已创建`);
        setCreateOpen(false);
        setForm({ email: "", name: "", password: "", role: "USER", quotaGB: "" });
        load(search);
      } else toast.error(json.error);
    } finally {
      setCreating(false);
    }
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
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" /> 添加用户
          </Button>
        </div>
      </div>

      {/* 批量操作栏：全选本页 + 批量封禁/解封 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={users.length > 0 && users.every((u) => selected.has(u.id))}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          全选本页
        </label>
        <span className="text-muted-foreground">已选 {selected.size} 个</span>
        <Button size="sm" variant="outline" disabled={updating === "batch" || selected.size === 0} onClick={() => batchStatus("ACTIVE")}>
          <ShieldCheck className="h-4 w-4" /> 批量解封
        </Button>
        <Button size="sm" variant="destructive" disabled={updating === "batch" || selected.size === 0} onClick={() => batchStatus("BANNED")}>
          <Ban className="h-4 w-4" /> 批量封禁
        </Button>
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
                <th className="w-10 p-2.5">
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    checked={users.length > 0 && users.every((u) => selected.has(u.id))}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
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
                    <input
                      type="checkbox"
                      aria-label={`选择 ${u.name}`}
                      checked={selected.has(u.id)}
                      onChange={() => toggle(u.id)}
                    />
                  </td>
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updating === u.id}
                        onClick={() => {
                          if (u.role === "ADMIN" && !confirm(`确定将 ${u.name} 降级为普通用户？`)) return;
                          update(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" });
                        }}
                      >
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

      {/* 添加用户弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">邮箱</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">用户名</label>
              <Input
                placeholder="2-20 个字符"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">初始密码</label>
              <Input
                type="password"
                placeholder="至少 8 位，含大小写字母与数字"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">角色</label>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="USER">普通用户</option>
                  <option value="ADMIN">管理员</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">配额（GB，留空用默认）</label>
                <Input
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder="默认"
                  value={form.quotaGB}
                  onChange={(e) => setForm({ ...form, quotaGB: e.target.value })}
                />
              </div>
            </div>
            <Button className="w-full" disabled={creating} onClick={createUser}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
