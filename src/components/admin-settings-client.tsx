"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import type { R2SlotConfig, SiteSettings } from "@/lib/settings";
import type { SyncStatus } from "@/server/r2-sync.service";
import { SLOT_TYPES, slotConfigured, slotDisplayName, type SlotType } from "@/lib/markers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 站点设置：常规（站点名 / 开放注册 / 上传上限）+ 邮件（SMTP）配置
export function AdminSettingsClient() {
  const router = useRouter();
  const [form, setForm] = useState<SiteSettings | null>(null);
  // 上限/端口输入框保留原始字符串，允许清空；保存时才解析，避免清空瞬间被回填 0
  const [maxMbInput, setMaxMbInput] = useState("");
  const [portInput, setPortInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // R2 连接测试
  const [r2Testing, setR2Testing] = useState(false);
  // R2 记录一致性校验/清理（孤儿记录：数据库有记录、桶里没文件）
  const [rc, setRc] = useState<{
    running: boolean;
    result: { checked: number; present: number; missing: number; unconfigured: number; missingIds: string[] } | null;
  }>({ running: false, result: null });
  // R2 实时同步状态（每 10 秒轮询展示；后台每 30 秒自动对账）
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
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
      // 每个槽位要么留空、要么三项可见字段齐全且密钥已填或已存（hasSecret）
      for (let i = 0; i < form.r2Slots.length; i++) {
        const s = form.r2Slots[i];
        const touched = s.accountId || s.accessKeyId || s.secretAccessKey || s.bucket;
        const complete = slotConfigured(s) && (s.secretAccessKey || s.hasSecret);
        if (touched && !complete) {
          toast.error(`${slotDisplayName(s, i, form.r2Slots.length)}配置不完整：请按表单提示填写完整，已保存的桶留空 Secret 即可`);
          return;
        }
      }
      if (form.storageDriver === "r2" && form.r2Slots.length === 0) {
        toast.error("已选择对象存储，请先「添加存储」并配置桶信息");
        return;
      }
      if (form.storageDriver === "r2") {
        const idx = Math.min(form.r2UploadSlot, form.r2Slots.length - 1);
        const up = form.r2Slots[idx];
        if (!(slotConfigured(up) && (up.secretAccessKey || up.hasSecret))) {
          toast.error(`上传目标 ${slotDisplayName(up, idx, form.r2Slots.length)} 配置不完整`);
          return;
        }
      }
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, maxUploadMB: maxMb, smtpPort: port }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("设置已保存");
        // ajax 局部刷新：RSC 重取同步侧栏（存储驱动 / R2 桶卡片 / 站点名等），不整页 reload
        router.refresh();
      } else toast.error(json.error);
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

  // R2 连接测试：用某个桶的当前表单配置真实读写一个探测对象
  // 密钥留空（已保存在服务端）时带 slotIndex，让接口回退用已存的 Secret
  async function testR2(cfg: R2SlotConfig, slotIndex?: number) {
    const baseOk = (cfg.accountId || cfg.endpoint) && cfg.accessKeyId && cfg.bucket;
    const secretOk = cfg.secretAccessKey || cfg.hasSecret;
    if (!baseOk || !secretOk) {
      toast.error("请先填写 Account ID（或 S3 端点）/ Access Key / Secret / Bucket");
      return;
    }
    setR2Testing(true);
    try {
      const res = await fetch("/api/admin/storage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg.secretAccessKey ? cfg : { ...cfg, slotIndex }),
      });
      const json = await res.json();
      if (json.ok) toast.success(json.data.message);
      else toast.error(json.error);
    } catch {
      toast.error("连接请求失败，请检查网络");
    } finally {
      setR2Testing(false);
    }
  }

  // 添加一个存储槽位：先选类型（R2 / OSS / COS / S3 兼容），按类型渲染对应表单
  function addSlot(type: SlotType) {
    if (!form) return;
    if (form.r2Slots.length >= 8) {
      toast.error("最多添加 8 个存储桶");
      return;
    }
    setForm({ ...form, r2Slots: [...form.r2Slots, { type, accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "" }] });
  }

  // 删除某个 R2 存储桶槽位（桶内未迁走的文件将无法访问）
  function removeSlot(i: number) {
    if (!form) return;
    if (!confirm(`删除 ${slotDisplayName(form.r2Slots[i], i, form.r2Slots.length)} 的配置？\n\n若该桶中仍有图片（未迁移走），删除后这些图片将无法访问。`)) return;
    const slots = form.r2Slots.filter((_, n) => n !== i);
    let uploadSlot = form.r2UploadSlot;
    if (uploadSlot > i) uploadSlot -= 1;
    if (uploadSlot >= slots.length) uploadSlot = Math.max(slots.length - 1, 0);
    setForm({ ...form, r2Slots: slots, r2UploadSlot: uploadSlot });
  }

  // R2 记录一致性校验：数据库记录 vs 桶内真实对象
  async function checkR2() {
    setRc({ running: true, result: null });
    try {
      const res = await fetch("/api/admin/storage/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      const json = await res.json();
      if (json.ok) {
        setRc({ running: false, result: json.data });
        if (json.data.missing > 0) toast.warning(`发现 ${json.data.missing} 条孤儿记录（桶里没有对应文件）`);
        else toast.success("全部记录与桶内对象一致");
      } else toast.error(json.error);
    } catch {
      toast.error("校验请求失败，请重试");
      setRc((s) => ({ ...s, running: false }));
    }
  }

  // 清理校验出的缺失记录（二次确认）
  async function cleanR2() {
    const ids = rc.result?.missingIds ?? [];
    if (!ids.length) return;
    if (!confirm(`确定删除 ${ids.length} 条指向不存在文件的记录？\n\n仅删除校验中确认桶内无对应对象的记录，不可恢复。`)) return;
    setRc((s) => ({ ...s, running: true }));
    try {
      const res = await fetch("/api/admin/storage/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup", ids }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`已清理 ${json.data.cleaned} 条缺失记录`);
        setRc({ running: false, result: null });
      } else {
        toast.error(json.error);
        setRc((s) => ({ ...s, running: false }));
      }
    } catch {
      toast.error("清理请求失败，请重试");
      setRc((s) => ({ ...s, running: false }));
    }
  }

  // R2 实时同步状态轮询
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/storage/sync")
        .then((r) => r.json())
        .then((json) => {
          if (alive && json.ok) setSync(json.data as SyncStatus);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // 立即同步一轮（桶内对象 ⇋ 数据库记录）
  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/storage/sync", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        const data = json.data as SyncStatus;
        setSync(data);
        const adopted = data.slots.reduce((n, s) => n + s.adopted, 0);
        const removed = data.slots.reduce((n, s) => n + s.removed, 0);
        const errors = data.slots.filter((s) => s.error);
        if (errors.length > 0) toast.error(errors.map((s) => `${s.label}：${s.error}`).join("；"));
        else toast.success(`同步完成：收录 ${adopted} 张，移除 ${removed} 条记录`);
      } else toast.error(json.error);
    } finally {
      setSyncing(false);
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
        // 还原覆盖了全部数据：就地回读设置表单 + RSC 局部刷新，不整页 reload
        try {
          const res2 = await fetch("/api/admin/settings");
          const j2 = await res2.json();
          if (j2.ok) {
            setForm(j2.data);
            setMaxMbInput(String(j2.data.maxUploadMB));
            setPortInput(j2.data.smtpPort ? String(j2.data.smtpPort) : "");
          }
        } catch {
          // 回读失败不阻塞，下次进入页面会刷新
        }
        router.refresh();
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

  // 更新表单局部字段
  const upd = (patch: Partial<SiteSettings>) => setForm({ ...form, ...patch });

  // 更新某个 R2 槽位的字段
  const updSlot = (i: number, patch: Partial<R2SlotConfig>) =>
    setForm({ ...form, r2Slots: form.r2Slots.map((s, n) => (n === i ? { ...s, ...patch } : s)) });

  // 存储槽位配置块（第 i 个槽位）：按槽位类型渲染对应表单
  // R2 恢复原始四项表单；OSS/COS 填 Region（端点自动推导）；S3 兼容手填端点
  const r2Block = (i: number) => {
    const s = form.r2Slots[i];
    const type = s.type ?? "r2";
    const typeName = SLOT_TYPES.find((t) => t.type === type)?.name ?? "Cloudflare R2";
    const secretPlaceholder = s.hasSecret
      ? "已保存（留空保持不变）"
      : type === "oss"
        ? "阿里云 AccessKey Secret"
        : type === "cos"
          ? "腾讯云 SecretKey"
          : "API 令牌的 Secret Access Key";
    return (
      <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2">
        <div className="flex items-center justify-between md:col-span-2">
          <p className="text-xs font-medium">
            {slotDisplayName(s, i, form.r2Slots.length)}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">{typeName}</span>
          </p>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="radio"
                name="r2-upload-target"
                checked={form.r2UploadSlot === i}
                onChange={() => setForm({ ...form, r2UploadSlot: i })}
              />
              设为上传目标
            </label>
            <button
              onClick={() => removeSlot(i)}
              className="flex items-center gap-1 text-xs text-red-500/80 transition-colors hover:text-red-500"
              title="删除该桶配置"
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </div>

        {type === "r2" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-account`}>Account ID</Label>
              <Input
                id={`r2-${i}-account`}
                placeholder="R2 概览页的 Account ID（32 位十六进制）"
                value={s.accountId}
                onChange={(e) => updSlot(i, { accountId: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-bucket`}>Bucket（存储桶名）</Label>
              <Input
                id={`r2-${i}-bucket`}
                placeholder="如 imagehub"
                value={s.bucket}
                onChange={(e) => updSlot(i, { bucket: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-key`}>Access Key ID</Label>
              <Input
                id={`r2-${i}-key`}
                placeholder="R2 API 令牌的 Access Key ID"
                value={s.accessKeyId}
                onChange={(e) => updSlot(i, { accessKeyId: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-secret`}>Secret Access Key</Label>
              <Input
                id={`r2-${i}-secret`}
                type="password"
                placeholder={secretPlaceholder}
                value={s.secretAccessKey}
                onChange={(e) => updSlot(i, { secretAccessKey: e.target.value })}
              />
            </div>
          </>
        )}

        {(type === "oss" || type === "cos") && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-region`}>Region（地域）</Label>
              <Input
                id={`r2-${i}-region`}
                placeholder={type === "oss" ? "如 oss-cn-hangzhou" : "如 ap-guangzhou"}
                value={s.region ?? ""}
                onChange={(e) => updSlot(i, { region: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-bucket`}>Bucket（存储桶名）</Label>
              <Input
                id={`r2-${i}-bucket`}
                placeholder={type === "cos" ? "如 imagehub-1250000000" : "如 imagehub"}
                value={s.bucket}
                onChange={(e) => updSlot(i, { bucket: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-key`}>Access Key ID</Label>
              <Input
                id={`r2-${i}-key`}
                placeholder={type === "oss" ? "阿里云 AccessKey ID" : "腾讯云 SecretId"}
                value={s.accessKeyId}
                onChange={(e) => updSlot(i, { accessKeyId: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-secret`}>Access Key Secret</Label>
              <Input
                id={`r2-${i}-secret`}
                type="password"
                placeholder={secretPlaceholder}
                value={s.secretAccessKey}
                onChange={(e) => updSlot(i, { secretAccessKey: e.target.value })}
              />
            </div>
          </>
        )}

        {type === "s3" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-endpoint`}>S3 端点</Label>
              <Input
                id={`r2-${i}-endpoint`}
                placeholder="如 https://s3.bj.baidubce.com（百度 BOS）或 http://minio.local:9000"
                value={s.endpoint ?? ""}
                onChange={(e) => updSlot(i, { endpoint: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-region`}>Region（地域）</Label>
              <Input
                id={`r2-${i}-region`}
                placeholder="如 bj（百度 BOS 北京）/ us-east-1，不确定可留空"
                value={s.region ?? ""}
                onChange={(e) => updSlot(i, { region: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-bucket`}>Bucket（存储桶名）</Label>
              <Input
                id={`r2-${i}-bucket`}
                placeholder="如 imagehub"
                value={s.bucket}
                onChange={(e) => updSlot(i, { bucket: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-key`}>Access Key ID</Label>
              <Input
                id={`r2-${i}-key`}
                placeholder="S3 兼容存储的 Access Key ID"
                value={s.accessKeyId}
                onChange={(e) => updSlot(i, { accessKeyId: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`r2-${i}-secret`}>Secret Access Key</Label>
              <Input
                id={`r2-${i}-secret`}
                type="password"
                placeholder={secretPlaceholder}
                value={s.secretAccessKey}
                onChange={(e) => updSlot(i, { secretAccessKey: e.target.value })}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`r2-${i}-label`}>显示名（可选）</Label>
          <Input
            id={`r2-${i}-label`}
            placeholder={type === "r2" ? "默认 R2 / R2-1 / R2-2…" : "默认 OSS / COS / S3 + 序号"}
            value={s.label ?? ""}
            onChange={(e) => updSlot(i, { label: e.target.value })}
          />
        </div>
        <div className="flex items-end gap-3">
          <Button variant="outline" onClick={() => testR2(s, i)} disabled={r2Testing}>
            {r2Testing ? <Loader2 className="animate-spin" /> : null} 测试连接
          </Button>
          <span className="pb-2 text-xs text-muted-foreground">
            {type === "r2" && "在 Cloudflare → R2 → 管理 R2 API 令牌创建「对象读和写」令牌"}
            {type === "oss" && "需开通 OSS 并创建 AccessKey；端点按 Region 自动生成"}
            {type === "cos" && "需开通 COS 并创建密钥；端点按 Region 自动生成"}
            {type === "s3" && "适用于 MinIO / Wasabi / B2 / 百度 BOS 等 S3 兼容存储；百度 BOS 端点为 https://s3.地域.baidubce.com（北京=bj、广州=gz、苏州=su），AK/SK 在百度智能云「安全认证」页获取"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">站点设置</h1>
      {/* 单列布局：一张卡片占满一行 */}
      <div className="space-y-4">
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
              placeholder={form.hasSmtpPass ? "已保存（留空保持不变）" : "邮箱服务方的授权码"}
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
          <CardTitle className="text-base">存储设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="storage-driver">存储位置（新上传文件写入此处）</Label>
            <Select
              id="storage-driver"
              value={form.storageDriver}
              onChange={(e) => setForm({ ...form, storageDriver: e.target.value as SiteSettings["storageDriver"] })}
            >
              <option value="local">本地磁盘（存放在服务器 VPS 上）</option>
              <option value="r2">对象存储（R2 / OSS / COS / MinIO…，不占用 VPS 空间）</option>
            </Select>
          </div>

          {/* 添加按钮在桶配置块上方：先选存储类型，再按类型填写表单 */}
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={form.r2Slots.length >= 8}>
                  <Plus className="h-4 w-4" /> 添加存储{form.r2Slots.length >= 8 ? "（已达上限）" : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {SLOT_TYPES.map((t) => (
                  <DropdownMenuItem key={t.type} onClick={() => addSlot(t.type)}>
                    <span className="flex flex-col">
                      <span>{t.name}</span>
                      <span className="text-xs text-muted-foreground">{t.hint}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {form.storageDriver === "r2" && form.r2Slots.length === 0 && (
              <span className="text-xs text-amber-600">已选择对象存储，请添加并配置存储桶后保存</span>
            )}
          </div>

          {form.r2Slots.map((_, i) => (
            <span key={i} className="block">
              {r2Block(i)}
            </span>
          ))}

          <p className="text-xs text-muted-foreground">
            各存储的密钥获取方式见对应表单下方的提示文字；桶无需公开访问，图片仍经本站受保护接口对外提供。
            每张图片会记录其实际存放位置：切换驱动或勾选其他上传桶只影响新上传，已有文件仍按原位置正常访问与删除；
            「备份与还原」仅包含本地磁盘上的文件，对象存储中的文件请用对应云厂商自身机制备份。
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null} 保存存储设置
            </Button>
          </div>

          {/* 存量迁移已独立成页：/admin/migrate（逐张勾选、带存储徽标） */}
          <div className="space-y-3 border-t border-border pt-4">
            <Label>存量图片迁移</Label>
            <p className="text-xs text-muted-foreground">
              已独立为「存储迁移」页面：可选源位置与目标位置，逐张勾选要迁移的图片（每张带 本地 / R2 存储徽标），
              本地照片只有在该页面手动迁移才会进入存储桶。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => router.push("/admin/migrate")}>打开存储迁移</Button>
            </div>
            {/* R2 记录一致性校验：数据库记录 vs 桶内真实对象（孤儿记录清理） */}
            <div className="space-y-2 border-t pt-4">
              <Label>记录一致性校验</Label>
              <p className="text-xs text-muted-foreground">
                逐个核对指向 R2 的记录与桶内真实对象。若曾在 Cloudflare 后台直接清空过桶，数据库会残留孤儿记录
                （页面显示有文件、桶里实际没有），可在此校验并清理。清理前请确认上方桶配置与当初写入的桶一致。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={checkR2} disabled={rc.running}>
                  {rc.running ? <Loader2 className="size-4 animate-spin" /> : null} 校验记录与桶一致性
                </Button>
                {rc.result && (
                  <span className="text-xs text-muted-foreground">
                    共 {rc.result.checked} 条：存在 {rc.result.present}，缺失 {rc.result.missing}
                    {rc.result.unconfigured > 0 ? `，无法校验（槽位未配置）${rc.result.unconfigured}` : ""}
                  </span>
                )}
                {rc.result && rc.result.missing > 0 && (
                  <Button variant="destructive" onClick={cleanR2} disabled={rc.running}>
                    清理 {rc.result.missing} 条缺失记录
                  </Button>
                )}
              </div>
            </div>

            {/* R2 实时同步：桶内对象为事实源，定时双向对账 */}
            <div className="space-y-2 border-t pt-4">
              <Label>R2 实时同步</Label>
              <p className="text-xs text-muted-foreground">
                同步方向永远是「存储桶 → 网站」：桶里新增的照片自动收录进网站（公开、归管理员，缩略图回源原对象），
                桶里被手动删除的照片对应记录自动清除；只增删数据库记录，<strong>绝不会</strong>把本地文件上传到存储桶。
                每 30 秒对账一次，迁移进行中自动暂停；收录仅针对存在超过 2 分钟的图片/视频对象，以避开上传竞态。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={syncNow} disabled={syncing || !!sync?.running}>
                  {syncing || sync?.running ? <Loader2 className="size-4 animate-spin" /> : null} 立即同步
                </Button>
                {sync?.lastRun ? (
                  <span className="text-xs text-muted-foreground">上次对账：{new Date(sync.lastRun).toLocaleTimeString()}</span>
                ) : null}
              </div>
              {sync?.slots.map((s) => (
                <p key={s.marker} className="text-xs text-muted-foreground">
                  {s.label}：桶内 {s.checked} 个对象
                  {s.error ? ` · 出错：${s.error}` : s.at ? ` · 收录 ${s.adopted}，移除 ${s.removed}` : ""}
                </p>
              ))}
            </div>
          </div>
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
