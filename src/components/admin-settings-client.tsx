"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import type { R2SlotConfig, SiteSettings } from "@/lib/settings";

// R2 槽位显示名（R2 一 / R2 二 / …）；不能从 @/lib/storage 引（会把 prisma 拖进客户端包）
const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const r2Label = (i: number) => `R2 ${CN_NUM[i] ?? i + 1}`;
const markerLabel = (m: string) => (m === "local" ? "本地磁盘" : r2Label(Number(m.slice(3)) || 0));

type MigrationStatus = {
  running: boolean;
  direction: string | null;
  done: number;
  total: number;
  failed: number;
  errors: string[];
  startedAt: number | null;
  finishedAt: number | null;
};

// 站点设置：常规（站点名 / 开放注册 / 上传上限）+ 邮件（SMTP）配置
export function AdminSettingsClient() {
  const [form, setForm] = useState<SiteSettings | null>(null);
  // 上限/端口输入框保留原始字符串，允许清空；保存时才解析，避免清空瞬间被回填 0
  const [maxMbInput, setMaxMbInput] = useState("");
  const [portInput, setPortInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // R2 连接测试
  const [r2Testing, setR2Testing] = useState(false);
  // 存量迁移：挂载即拉取一次状态（刷新页面不丢进度），并持续轮询
  const [mig, setMig] = useState<MigrationStatus | null>(null);
  // 迁移方向：从 / 到（local | r2:<桶下标>）
  const [migFrom, setMigFrom] = useState("local");
  const [migTo, setMigTo] = useState("r2:0");
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

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () =>
      fetch("/api/admin/storage/migrate")
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) return;
          setMig((prev) => {
            const next = json.data as MigrationStatus;
            if (prev?.running && !next.running && next.total > 0) {
              if (next.failed > 0)
                toast.warning(`迁移结束：成功 ${next.done - next.failed}/${next.total}，失败 ${next.failed}（失败图片保留原位置，可重新发起重试）`);
              else toast.success(`迁移完成：共 ${next.total} 个文件`);
            }
            return next;
          });
        })
        .catch(() => {});
    tick();
    timer = setInterval(tick, 2000);
    return () => {
      if (timer) clearInterval(timer);
    };
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
        const complete = s.accountId && s.accessKeyId && s.bucket && (s.secretAccessKey || s.hasSecret);
        if (touched && !complete) {
          toast.error(`${r2Label(i)}配置不完整：新桶或修改过密钥时需填写完整四项，已保存的桶留空 Secret 即可`);
          return;
        }
      }
      if (form.storageDriver === "r2" && form.r2Slots.length === 0) {
        toast.error("已选择 R2 存储，请先「添加 R2 存储」并配置桶信息");
        return;
      }
      if (form.storageDriver === "r2") {
        const idx = Math.min(form.r2UploadSlot, form.r2Slots.length - 1);
        const up = form.r2Slots[idx];
        if (!(up.accountId && up.accessKeyId && up.bucket && (up.secretAccessKey || up.hasSecret))) {
          toast.error(`上传目标 ${r2Label(idx)} 配置不完整`);
          return;
        }
      }
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

  // R2 连接测试：用某个桶的当前表单配置真实读写一个探测对象
  // 密钥留空（已保存在服务端）时带 slotIndex，让接口回退用已存的 Secret
  async function testR2(cfg: R2SlotConfig, slotIndex?: number) {
    const baseOk = cfg.accountId && cfg.accessKeyId && cfg.bucket;
    const secretOk = cfg.secretAccessKey || cfg.hasSecret;
    if (!baseOk || !secretOk) {
      toast.error("请先填写 Account ID / Access Key / Secret / Bucket");
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

  // 添加一个 R2 存储桶槽位
  function addSlot() {
    if (!form) return;
    if (form.r2Slots.length >= 8) {
      toast.error("最多添加 8 个 R2 存储桶");
      return;
    }
    setForm({ ...form, r2Slots: [...form.r2Slots, { accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "" }] });
  }

  // 删除某个 R2 存储桶槽位（桶内未迁走的文件将无法访问）
  function removeSlot(i: number) {
    if (!form) return;
    if (!confirm(`删除 ${r2Label(i)} 的配置？\n\n若该桶中仍有图片（未迁移走），删除后这些图片将无法访问。`)) return;
    const slots = form.r2Slots.filter((_, n) => n !== i);
    let uploadSlot = form.r2UploadSlot;
    if (uploadSlot > i) uploadSlot -= 1;
    if (uploadSlot >= slots.length) uploadSlot = Math.max(slots.length - 1, 0);
    setForm({ ...form, r2Slots: slots, r2UploadSlot: uploadSlot });
  }

  // 发起存量迁移：任意两个存储位置之间（从 migFrom 到 migTo）
  async function startMigrate() {
    const from = migFrom;
    const to = migTo;
    if (
      !confirm(
        `把存量文件从「${markerLabel(from)}」迁移到「${markerLabel(to)}」？\n\n将逐张复制文件并删除源位置文件，迁移期间请勿上传或删除图片；\n页面或服务重启会中断迁移，未迁移的文件重新发起即可续迁。`
      )
    )
      return;
    try {
      const res = await fetch("/api/admin/storage/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`迁移 ${markerLabel(from)} → ${markerLabel(to)} 已开始`);
        setMig((m) =>
          m
            ? { ...m, running: true, done: 0, total: 0, failed: 0, errors: [], finishedAt: null, direction: `${from}>${to}` }
            : m
        );
      } else toast.error(json.error);
    } catch {
      toast.error("迁移请求失败，请重试");
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

  // 更新表单局部字段
  const upd = (patch: Partial<SiteSettings>) => setForm({ ...form, ...patch });

  // 更新某个 R2 槽位的字段
  const updSlot = (i: number, patch: Partial<R2SlotConfig>) =>
    setForm({ ...form, r2Slots: form.r2Slots.map((s, n) => (n === i ? { ...s, ...patch } : s)) });

  // 某存储位置是否已具备配置（local 恒为就绪；Secret 已填或已存均可）
  const slotConfigured = (m: string) => {
    if (m === "local") return true;
    const s = form.r2Slots[Number(m.slice(3)) || 0];
    return !!(s && s.accountId && s.accessKeyId && s.bucket && (s.secretAccessKey || s.hasSecret));
  };

  // R2 桶配置块（第 i 个槽位）：含「设为上传目标」单选与删除按钮
  const r2Block = (i: number) => {
    const s = form.r2Slots[i];
    return (
      <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2">
        <div className="flex items-center justify-between md:col-span-2">
          <p className="text-xs font-medium">{r2Label(i)}</p>
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
            placeholder={s.hasSecret ? "已保存（留空保持不变）" : "R2 API 令牌的 Secret Access Key"}
            value={s.secretAccessKey}
            onChange={(e) => updSlot(i, { secretAccessKey: e.target.value })}
          />
        </div>
        <div className="flex items-end md:col-span-2">
          <Button variant="outline" onClick={() => testR2(s, i)} disabled={r2Testing}>
            {r2Testing ? <Loader2 className="animate-spin" /> : null} 测试连接
          </Button>
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
              <option value="r2">Cloudflare R2（对象存储，不占用 VPS 空间）</option>
            </Select>
          </div>

          {/* 添加按钮在 R2 桶配置块上方；新桶追加到列表末尾 */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={addSlot} disabled={form.r2Slots.length >= 8}>
              <Plus className="h-4 w-4" /> 添加 R2 存储
            </Button>
            {form.storageDriver === "r2" && form.r2Slots.length === 0 && (
              <span className="text-xs text-amber-600">已选择 R2 存储，请添加并配置存储桶后保存</span>
            )}
          </div>

          {form.r2Slots.map((_, i) => (
            <span key={i} className="block">
              {r2Block(i)}
            </span>
          ))}

          <p className="text-xs text-muted-foreground">
            在 Cloudflare 控制台 → R2 → 管理 R2 API 令牌 创建「对象读和写」权限的令牌；桶无需公开访问，图片仍经本站受保护接口对外提供。
            每张图片会记录其实际存放位置：切换驱动或勾选其他上传桶只影响新上传，已有文件仍按原位置正常访问与删除；
            「备份与还原」仅包含本地磁盘上的文件，R2 中的文件请用 Cloudflare 自身机制备份。
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null} 保存存储设置
            </Button>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <Label>存量图片迁移</Label>
            <p className="text-xs text-muted-foreground">
              把已上传的文件在 本地磁盘 与各个 R2 桶之间整体搬迁（读源 → 写目标 → 更新记录 → 删除源文件），
              迁移完成后源位置空间即释放。
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="mig-from">从</Label>
                <Select id="mig-from" value={migFrom} onChange={(e) => setMigFrom(e.target.value)}>
                  <option value="local">本地磁盘</option>
                  {form.r2Slots.map((_, i) => (
                    <option key={i} value={`r2:${i}`}>
                      {r2Label(i)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mig-to">到</Label>
                <Select id="mig-to" value={migTo} onChange={(e) => setMigTo(e.target.value)}>
                  <option value="local">本地磁盘</option>
                  {form.r2Slots.map((_, i) => (
                    <option key={i} value={`r2:${i}`}>
                      {r2Label(i)}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="outline"
                onClick={startMigrate}
                disabled={!!mig?.running || migFrom === migTo || !slotConfigured(migFrom) || !slotConfigured(migTo)}
              >
                开始迁移
              </Button>
              {mig?.running && (
                <span className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  迁移进行中…
                </span>
              )}
            </div>
            {mig && mig.total > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {mig.direction
                      ? `${markerLabel(mig.direction.split(">")[0])} → ${markerLabel(mig.direction.split(">")[1])}：`
                      : ""}
                    {mig.running ? "迁移中" : "已结束"}：{mig.done}/{mig.total}
                    {mig.failed > 0 ? `，失败 ${mig.failed}` : ""}
                  </span>
                  <span>{mig.total > 0 ? `${Math.round((mig.done / mig.total) * 100)}%` : ""}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${mig.total > 0 ? (mig.done / mig.total) * 100 : 0}%` }} />
                </div>
                {mig.errors.length > 0 && (
                  <div className="text-xs text-red-500">
                    {mig.errors.slice(0, 3).map((e, i) => (
                      <p key={i} className="truncate">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
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
