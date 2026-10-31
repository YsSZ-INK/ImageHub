"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AvatarFallbackIcon } from "@/components/avatar";
import { formatBytes, formatDate } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

type Props = {
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
    emailVerified: string | null;
    storageUsed: string;
    storageQuota: string;
    createdAt: string;
  };
};

// 个人中心：昵称/头像/密码/配额/邮箱验证/注销
export function SettingsClient({ user }: Props) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [savingName, setSavingName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verified, setVerified] = useState(!!user.emailVerified);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const used = Number(user.storageUsed);
  const quota = Number(user.storageQuota);
  const pct = Math.min(100, Math.round((used / Math.max(quota, 1)) * 100));

  // 冷却倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 未验证时轮询验证状态：用户在邮件里点击链接后本页自动变为已验证
  useEffect(() => {
    if (verified) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/account/verify");
        const json = await res.json();
        if (json.ok && json.data.verified) {
          setVerified(true);
          toast.success("邮箱验证成功");
        }
      } catch {
        // 网络波动忽略，下个周期重试
      }
    }, 5000);
    return () => clearInterval(t);
  }, [verified]);

  async function saveName() {
    setSavingName(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("昵称已保存");
        router.refresh();
      } else toast.error(json.error);
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword() {
    setSavingPwd(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("密码已更新");
        setCurrentPassword("");
        setNewPassword("");
      } else toast.error(json.error);
    } finally {
      setSavingPwd(false);
    }
  }

  async function uploadAvatar(f: File) {
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/account/avatar", { method: "POST", body: form });
      const json = await res.json();
      if (json.ok) {
        toast.success("头像已更新");
        router.refresh();
      } else toast.error(json.error);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function sendVerify() {
    setSending(true);
    try {
      const res = await fetch("/api/account/verify", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.data.message);
        setCooldown(60);
      } else toast.error(json.error);
    } catch {
      toast.error("网络错误，请稍后再试");
    } finally {
      setSending(false);
    }
  }

  async function deleteAccount() {
    if (!confirm("注销后所有图片与数据将被永久删除且不可恢复，确定继续？")) return;
    if (!confirm("再次确认：真的要注销账号吗？")) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        await signOut({ redirect: false });
        router.push("/");
      } else toast.error(json.error);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">个人中心</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 基本信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <AvatarFallbackIcon name={user.name} url={user.avatarUrl} size={56} />
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
                />
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadingAvatar}>
                  {uploadingAvatar ? <Loader2 className="animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 更换头像
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">昵称 / 用户名</Label>
              <div className="flex gap-2">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
                <Button onClick={saveName} disabled={savingName || name === user.name}>
                  {savingName ? <Loader2 className="animate-spin" /> : null} 保存
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              邮箱状态：
              {verified ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">已验证</span>
              ) : (
                <>
                  <span className="font-medium text-amber-600 dark:text-amber-400">未验证</span>
                  <button
                    onClick={sendVerify}
                    disabled={sending || cooldown > 0}
                    className="ml-1 inline-flex items-center gap-1 text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sending && <Loader2 className="h-3 w-3 animate-spin" />}
                    {cooldown > 0 ? `重新发送（${cooldown}s）` : "发送验证邮件"}
                  </button>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">注册时间：{formatDate(user.createdAt)}</p>
          </CardContent>
        </Card>

        {/* 配额 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">存储配额（仅本地文件占用）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={pct} />
            <p className="text-sm text-muted-foreground">
              已用 {formatBytes(used)} / 总量 {formatBytes(quota)}（{pct}%）
            </p>
          </CardContent>
        </Card>

        {/* 修改密码 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">修改密码</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-pwd">当前密码</Label>
              <Input id="cur-pwd" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pwd">新密码（至少 8 位，含大小写字母和数字）</Label>
              <Input id="new-pwd" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <Button onClick={changePassword} disabled={savingPwd || !currentPassword || !newPassword}>
              {savingPwd ? <Loader2 className="animate-spin" /> : null} 更新密码
            </Button>
          </CardContent>
        </Card>

        {/* 危险区 */}
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" /> 危险区
            </CardTitle>
            <CardDescription>注销账号将级联删除你的所有图片、相册与存储对象，不可恢复。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin" /> : null} 注销账号
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
