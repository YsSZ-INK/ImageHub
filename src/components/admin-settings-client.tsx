"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import type { SiteSettings } from "@/lib/settings";

// 站点设置：常规（站点名 / 开放注册 / 上传上限）+ 邮件（SMTP）配置
export function AdminSettingsClient() {
  const [form, setForm] = useState<SiteSettings | null>(null);
  // 上限/端口输入框保留原始字符串，允许清空；保存时才解析，避免清空瞬间被回填 0
  const [maxMbInput, setMaxMbInput] = useState("");
  const [portInput, setPortInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // 备份与还原
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        setForm(json.data);
        setMaxMbInput(String(json.data.maxUploadMB));
        setPortInput(json.data.smtpPort ? String(json.data.smtpPort) : "");
      });
  }, []);

  async function save() {
    if (!form) return;
    const maxMb = Number(maxMbInput);
    if (!maxMbInput || !Number.isInteger(maxMb) || maxMb < 1 || maxMb > 512) {
      toast.error("上传上限需为 1-512 的整数（MB）");
      return;
    }
    const port = portInput === "" ? 0 : Number(portInput);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      toast.error("SMTP 端口需为 0-65535 的整数（留空表示未设置）");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, maxUploadMB: maxMb, smtpPort: port }),
      });
      const json = await res.json();
      if (json.ok) toast.success("设置已保存");
      else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  }

  // 发送测试邮件：按已保存的 SMTP 配置真实发一封到当前管理员邮箱
  async function sendTestMail() {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/test-mail", { method: "POST" });
      const json = await res.json();
      if (json.ok) toast.success(json.data.message);
      else toast.error(json.error);
    } finally {
      setTesting(false);
    }
  }

  // 备份：直接导航到下载接口，由浏览器流式保存（Content-Disposition attachment）
  function startBackup() {
    if (!confirm("生成备份压缩包（数据库 + 全部存储文件）并下载？")) return;
    const a = document.createElement("a");
    a.href = "/api/admin/backup";
    a.download = "imagehub-backup.tar.gz";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("备份已开始生成，稍后自动下载");
  }

  // 还原：选择备份文件 → 强确认 → 整包上传，覆盖全部数据与存储文件
  async function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!file) return;
    if (!/\.(tar\.gz|tgz)$/i.test(file.name)) {
      toast.error("请选择 .tar.gz 备份文件");
      return;
    }
    if (
      !confirm(
        `确定用「${file.name}」还原站点？\n\n当前全部数据（用户、图片记录、相册、动态、站点设置与存储文件）将被备份内容覆盖，不可撤销！\n建议先「备份并下载」保存当前状态。`
      )
    )
      return;
    setRestoring(true);
    try {
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/x-tar+gzip" },
        body: file,
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.data.message);
        setTimeout(() => window.location.reload(), 1200);
      } else toast.error(json.error);
    } catch {
      toast.error("还原请求失败，请重试");
    } finally {
      setRestoring(false);
    }
  }

  if (!form) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <h1 className="text-xl font-bold">站点设置</h1>
      {/* 卡片按宽度自适应排列：窄屏单列，宽屏两列并排（items-start 防止等高拉伸） */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">常规</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="site-name">站点名称</Label>
            <Input id="site-name" value={form.siteName} onChange={(e) => setForm({ ...form, siteName: e.target.value })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="allow-reg">开放注册</Label>
            <Switch
              id="allow-reg"
              checked={form.allowRegister}
              onCheckedChange={(v) => setForm({ ...form, allowRegister: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max-mb">单文件上传上限（MB）</Label>
            <Input
              id="max-mb"
              type="number"
              min={1}
              max={512}
              value={maxMbInput}
              onChange={(e) => setMaxMbInput(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} 保存设置
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">邮件配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="smtp-host">SMTP 服务器</Label>
            <Input
              id="smtp-host"
              placeholder="留空表示未配置，如 smtp.example.com"
              value={form.smtpHost}
              onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-port">端口</Label>
            <Input
              id="smtp-port"
              type="number"
              min={0}
              max={65535}
              placeholder="留空表示未设置，常用 465（SSL）/ 587（STARTTLS）"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="smtp-secure">使用 SSL/TLS 加密</Label>
            <Switch
              id="smtp-secure"
              checked={form.smtpSecure}
              onCheckedChange={(v) => setForm({ ...form, smtpSecure: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-user">账号</Label>
            <Input
              id="smtp-user"
              placeholder="发信邮箱账号"
              value={form.smtpUser}
              onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-pass">密码 / 授权码</Label>
            <Input
              id="smtp-pass"
              type="password"
              placeholder="邮箱服务方的授权码"
              value={form.smtpPass}
              onChange={(e) => setForm({ ...form, smtpPass: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-from">发件人</Label>
            <Input
              id="smtp-from"
              placeholder="如 ImageHub <no-reply@example.com>"
              value={form.smtpFrom}
              onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null} 保存配置
            </Button>
            <Button variant="outline" onClick={sendTestMail} disabled={testing}>
              {testing ? <Loader2 className="animate-spin" /> : null} 发送测试邮件
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">测试邮件发送至当前管理员邮箱，需先保存配置。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">备份与还原</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            备份生成单个压缩包（gzip 最高压缩），包含全部数据（用户、图片记录、相册、动态、站点设置）与全部存储文件；
            还原时选择该文件即可，将覆盖当前站点全部数据。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={startBackup}>
              备份并下载
            </Button>
            <Button variant="destructive" disabled={restoring} onClick={() => restoreInputRef.current?.click()}>
              {restoring ? <Loader2 className="animate-spin" /> : null} 还原备份
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              className="hidden"
              onChange={onRestoreFile}
            />
          </div>
          <p className="text-xs text-muted-foreground">还原期间请勿进行上传等操作；还原完成后页面将自动刷新。</p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
