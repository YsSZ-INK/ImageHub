"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Unplug, ScrollText, ImageOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminLogsClient } from "@/components/admin-logs-client";
import type { R2SlotConfig, SiteSettings } from "@/lib/settings";
import type { SyncStatus } from "@/server/r2-sync.service";
import { SLOT_TYPES, slotConfigured, slotDisplayName, type SlotType } from "@/lib/markers";
import { formatBytes, shortDate } from "@/lib/utils";
import { PasswordInput } from "@/components/password-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// R2 实时同步面板：自带 10 秒轮询与手动触发，独立于主表单 state——
// 状态刷新只重渲染本面板（几十行），不会让整页长表单跟着 re-render（滚动卡顿来源之一）
function SyncStatusPanel() {
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  return (
    <div className="space-y-2 border-t pt-4">
      <Label>R2 实时同步</Label>
      <p className="text-xs text-muted-foreground">
        同步方向永远是「存储桶 → 网站」：桶里新增的照片自动收录进网站（公开、归管理员），
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
  );
}

// 桶内对象按「槽位 + key」唯一标识（不同桶可能有同名 key）
const orphanKey = (slot: string, key: string) => `${slot}|${key}`;

// 对账结果卡片：小缩略图 + 文件名 + 附加信息；图片取不到时显示占位图标
function ResultCard({
  src,
  title,
  meta,
  badge,
  checked,
  onToggle,
}: {
  src: string;
  title: string;
  meta: string;
  badge?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="block cursor-pointer overflow-hidden rounded-lg border">
      <div className="relative aspect-square bg-muted">
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
          <ImageOff className="h-5 w-5" />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title}
          loading="lazy"
          className="relative h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
        <input
          type="checkbox"
          className="absolute left-1.5 top-1.5 h-4 w-4"
          checked={checked}
          onChange={onToggle}
        />
        {badge && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 text-[10px] leading-4 text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-1.5">
        <p className="truncate text-[11px] font-medium" title={title}>
          {title}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">{meta}</p>
      </div>
    </label>
  );
}

// 站点设置：常规（站点名 / 开放注册 / 图片上传上限）+ 邮件（SMTP）配置
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
    result: {
      checked: number;
      present: number;
      missing: number;
      unconfigured: number;
      missingIds: string[];
      missingItems: { id: string; filename: string; size: number; storage: string; createdAt: string; ownerName: string | null }[];
      unconfiguredItems: { id: string; filename: string; size: number; storage: string; createdAt: string; ownerName: string | null }[];
    } | null;
  }>({ running: false, result: null });
  // 桶内多余文件核对（桶里有、网站已无记录）：列出后由管理员决定保留还是删除
  const [orphan, setOrphan] = useState<{
    running: boolean;
    result: {
      slots: number;
      objects: number;
      total: number;
      truncated: boolean;
      items: { slot: string; label: string; key: string; size: number; lastModified: string }[];
      errors: string[];
    } | null;
  }>({ running: false, result: null });
  const [orphanPicked, setOrphanPicked] = useState<Set<string>>(new Set());
  // 对账结果弹窗：核对完成后自动打开；左右两方择一查看图片
  const [resultOpen, setResultOpen] = useState(false);
  const [side, setSide] = useState<"missing" | "orphan">("missing");
  // 左侧（网站有记录）勾选、分页与批量动作状态
  const [missingPicked, setMissingPicked] = useState<Set<string>>(new Set());
  const [missingPage, setMissingPage] = useState(1);
  const [orphanPage, setOrphanPage] = useState(1);
  const [moving, setMoving] = useState(false);
  const [adopting, setAdopting] = useState(false);
  // 备份与还原
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  // 操作日志弹窗：独立按钮打开，不占用设置页版面
  const [logsOpen, setLogsOpen] = useState(false);

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
      toast.error("图片上传上限需为 1-512 的整数（MB）");
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
        // 邮件状态随保存重新探测（新配置立即生效可见，无需手动点检测）
        refreshMail();
      } else toast.error(json.error);
    } finally {
      setSaving(false);
    }
  }

  // 同步锁：state 生效前连点仍可能触发两次请求，用 ref 挡住重复提交
  const testingRef = useRef(false);

  // 发送测试邮件：按已保存的 SMTP 配置真实发一封到超级管理员邮箱
  async function sendTestMail() {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/test-mail", { method: "POST" });
      const json = await res.json();
      if (json.ok) toast.success(json.data.message);
      else toast.error(json.error);
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }

  // 邮件连接状态：服务端真实连接 + 认证握手探测（不发信）。
  // SMTP 无常驻连接，这是即时探测——打开页面、保存配置、手动点「检测连接」时刷新，
  // 用于发现首次配置成功后因密码被改、服务商封禁等问题导致的失效
  const [mail, setMail] = useState<{ status: string; host: string; error?: string } | null>(null);
  const [mailChecking, setMailChecking] = useState(false);
  async function refreshMail() {
    setMailChecking(true);
    try {
      const json = await fetch("/api/admin/settings/mail-status").then((r) => r.json());
      if (json.ok) setMail(json.data);
    } finally {
      setMailChecking(false);
    }
  }
  useEffect(() => {
    refreshMail();
  }, []);

  // Redis 连接状态与测试（状态为服务端当前生效连接，保存配置后点测试刷新）
  const [redis, setRedis] = useState<{ status: string; url: string; error: string; since: string; enabled: boolean } | null>(null);
  const [redisTesting, setRedisTesting] = useState(false);
  const refreshRedis = useCallback(async () => {
    const json = await fetch("/api/admin/settings/redis").then((r) => r.json());
    if (json.ok) setRedis(json.data);
  }, []);
  useEffect(() => {
    refreshRedis();
  }, [refreshRedis]);

  const [redisSaving, setRedisSaving] = useState(false);
  // 独立保存 Redis 配置（开关 + 地址），不随整表单提交；保存后立即刷新连接状态
  async function saveRedis() {
    if (!form) return;
    setRedisSaving(true);
    try {
      const res = await fetch("/api/admin/settings/redis", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redisEnabled: form.redisEnabled, redisUrl: form.redisUrl }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("Redis 配置已保存，已生效");
        await refreshRedis();
      } else toast.error(json.error);
    } finally {
      setRedisSaving(false);
    }
  }

  async function testRedis(useFormValue: boolean) {
    setRedisTesting(true);
    try {
      const res = await fetch("/api/admin/settings/redis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useFormValue ? { url: form?.redisUrl ?? "" } : {}),
      });
      const json = await res.json();
      if (json.ok) {
        if (json.data.ok) toast.success(json.data.message);
        else toast.error(json.data.message);
      } else toast.error(json.error);
      refreshRedis();
    } finally {
      setRedisTesting(false);
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

  // 断开连接：保留槽位（含类型与显示名），清空桶的全部连接配置；点「保存存储设置」后生效
  function disconnectSlot(i: number) {
    if (!form) return;
    const s = form.r2Slots[i];
    if (
      !confirm(
        `断开 ${slotDisplayName(s, i, form.r2Slots.length)} 的连接？\n\n将清空该桶的 Account ID / Access Key / Secret / Bucket 配置，点「保存存储设置」后生效。\n若该桶中仍有图片（未迁移走），断开后这些图片将无法访问。`
      )
    )
      return;
    setForm({
      ...form,
      r2Slots: form.r2Slots.map((slot, n) =>
        n === i ? { ...slot, accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "", region: "", endpoint: "" } : slot
      ),
    });
    toast.success("已断开连接，点「保存存储设置」后生效");
  }

  // R2 记录一致性校验：数据库记录 vs 桶内真实对象
  async function checkR2(): Promise<{ missing: number } | null> {
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
        setMissingPicked(new Set());
        setMissingPage(1);
        if (json.data.missing > 0) toast.warning(`发现 ${json.data.missing} 条孤儿记录（桶里没有对应文件）`);
        else toast.success("全部记录与桶内对象一致");
        return json.data;
      }
      toast.error(json.error);
      return null;
    } catch {
      toast.error("校验请求失败，请重试");
      setRc((s) => ({ ...s, running: false }));
      return null;
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

  // 存储对账：一次跑完两个方向，完成后自动弹出结果；有数据的一方默认展示
  async function checkStorage() {
    const [a, b] = await Promise.all([checkR2(), checkOrphans()]);
    setSide(a && a.missing > 0 ? "missing" : b && b.items.length > 0 ? "orphan" : "missing");
    setResultOpen(true);
  }

  // 核对桶内多余文件：列出「桶里有、网站已无记录」的对象
  async function checkOrphans(): Promise<{ items: unknown[] } | null> {
    setOrphan({ running: true, result: null });
    setOrphanPicked(new Set());
    setOrphanPage(1);
    try {
      const res = await fetch("/api/admin/storage/orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      const json = await res.json();
      if (json.ok) {
        setOrphan({ running: false, result: json.data });
        if (json.data.total > 0) toast.warning(`发现 ${json.data.total} 个网站已无记录的文件`);
        else toast.success("桶内没有多余文件");
        return json.data;
      }
      toast.error(json.error);
      setOrphan((s) => ({ ...s, running: false }));
      return null;
    } catch {
      toast.error("核对请求失败，请重试");
      setOrphan((s) => ({ ...s, running: false }));
      return null;
    }
  }

  // 删除选中的桶内多余文件（二次确认，服务端会再复核一次引用）
  async function deleteOrphans() {
    const items = (orphan.result?.items ?? []).filter((it) => orphanPicked.has(orphanKey(it.slot, it.key)));
    if (!items.length) return;
    if (!confirm(`确定从桶内删除选中的 ${items.length} 个文件？\n\n这些文件网站已无记录，删除后不可恢复。`)) return;
    setOrphan((s) => ({ ...s, running: true }));
    try {
      const res = await fetch("/api/admin/storage/orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", items: items.map((it) => ({ slot: it.slot, key: it.key })) }),
      });
      const json = await res.json();
      if (json.ok) {
        const { deleted, skipped, failed } = json.data;
        toast.success(`已从桶内删除 ${deleted} 个文件${skipped ? `，跳过 ${skipped} 个（网站仍在使用）` : ""}${failed ? `，失败 ${failed} 个` : ""}`);
        await checkOrphans();
      } else {
        toast.error(json.error);
        setOrphan((s) => ({ ...s, running: false }));
      }
    } catch {
      toast.error("删除请求失败，请重试");
      setOrphan((s) => ({ ...s, running: false }));
    }
  }

  // 左侧选中项移入桶内：按记录当前存储位置成组迁移到已配置的桶
  async function moveMissingToBucket() {
    const list = [...(rc.result?.missingItems ?? []), ...(rc.result?.unconfiguredItems ?? [])];
    const items = list.filter((it) => missingPicked.has(it.id));
    if (!items.length) return;
    if (!bucketTarget) {
      toast.error("请先在「存储设置」配置并保存一个对象存储桶");
      return;
    }
    const froms = new Set(items.map((it) => it.storage));
    if (froms.size > 1) {
      toast.error("所选图片分布在多个存储位置，请分批选择");
      return;
    }
    const from = [...froms][0];
    if (from === bucketTarget) {
      toast.error("这些图片已在目标桶内");
      return;
    }
    if (from.startsWith("r2:")) {
      const idx = Number.parseInt(from.slice(3), 10);
      const cfg = form?.r2Slots[idx];
      if (!cfg || !cfg.accessKeyId || !cfg.secretAccessKey || !slotConfigured(cfg)) {
        toast.error("这些原图所在的桶未配置，无法读取，请先补全该桶配置");
        return;
      }
    }
    if (!confirm(`把 ${items.length} 张图片从 ${from} 移入 ${bucketTarget}？\n\n会读取原图写入桶，成功后删除原位置文件。`)) return;
    setMoving(true);
    try {
      const res = await fetch("/api/admin/storage/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: bucketTarget, ids: items.map((it) => it.id) }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已开始移入桶内，可在「数据迁移」页查看进度");
        setMissingPicked(new Set());
      } else toast.error(json.error);
    } catch {
      toast.error("请求失败，请重试");
    } finally {
      setMoving(false);
    }
  }

  // 右侧选中项移入网站：下载到本地并收录为图片记录，成功后删除桶内副本
  async function adoptOrphans() {
    const items = (orphan.result?.items ?? []).filter((it) => orphanPicked.has(orphanKey(it.slot, it.key)));
    if (!items.length) return;
    if (!confirm(`把选中的 ${items.length} 个文件从桶内移入网站（下载到本地并收录为图片）？\n\n成功后删除桶内副本。`)) return;
    setAdopting(true);
    try {
      const res = await fetch("/api/admin/storage/orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adopt", items: items.map((it) => ({ slot: it.slot, key: it.key })) }),
      });
      const json = await res.json();
      if (json.ok) {
        const { adopted, failed } = json.data;
        toast.success(`已移入网站 ${adopted} 个${failed ? `，失败 ${failed} 个` : ""}`);
        setOrphanPicked(new Set());
        await checkOrphans();
      } else toast.error(json.error);
    } catch {
      toast.error("请求失败，请重试");
    } finally {
      setAdopting(false);
    }
  }

  // 备份：POST 触发生成并下载，前端拿到 blob 后交浏览器保存。
  // 备份会先驻留内存，个人站规模可接受；用 POST + 同源校验避免跨站静默触发下载。
  async function startBackup() {
    if (!confirm("生成备份压缩包（数据库 + 全部存储文件）并下载？")) return;
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error || "备份失败，请重试");
        return;
      }
      const blob = await res.blob();
      const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] ?? "imagehub-backup.tar.gz";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("备份完成，已开始下载");
    } catch {
      toast.error("备份请求失败，请重试");
    }
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
            <span
              className={`ml-1.5 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium ${
                slotConfigured(s) ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
              }`}
            >
              {slotConfigured(s) ? "已配置" : "未配置"}
            </span>
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
            {slotConfigured(s) && (
              <button
                onClick={() => disconnectSlot(i)}
                className="flex items-center gap-1 text-xs text-amber-600 transition-colors hover:text-amber-500"
                title="保留槽位，清空该桶的全部连接配置（保存后生效）"
              >
                <Unplug className="h-3.5 w-3.5" /> 断开连接
              </button>
            )}
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
              <PasswordInput
                id={`r2-${i}-secret`}
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
              <PasswordInput
                id={`r2-${i}-secret`}
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
              <PasswordInput
                id={`r2-${i}-secret`}
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

  // ===== 对账结果展示：分页、选中与目标桶 =====
  const PAGE_SIZE = 40;
  // 「移入桶内」的目标：第一个配置完整的桶
  const bucketTarget = (() => {
    if (!form) return null;
    const i = form.r2Slots.findIndex((c) => c.accessKeyId && c.secretAccessKey && slotConfigured(c));
    return i >= 0 ? `r2:${i}` : null;
  })();
  const leftList = [...(rc.result?.missingItems ?? []), ...(rc.result?.unconfiguredItems ?? [])];
  const missingIdSet = new Set((rc.result?.missingItems ?? []).map((it) => it.id));
  const leftPages = Math.max(1, Math.ceil(leftList.length / PAGE_SIZE));
  const leftPageItems = leftList.slice((missingPage - 1) * PAGE_SIZE, missingPage * PAGE_SIZE);
  const orphanList = orphan.result?.items ?? [];
  const orphanPages = Math.max(1, Math.ceil(orphanList.length / PAGE_SIZE));
  const orphanPageItems = orphanList.slice((orphanPage - 1) * PAGE_SIZE, orphanPage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      {/* 标题行：站点设置 + 操作日志按钮（点击弹出日志，不再单独占一个页签/版面） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">站点设置</h1>
        <Button variant="outline" onClick={() => setLogsOpen(true)}>
          <ScrollText className="h-4 w-4" /> 操作日志
        </Button>
      </div>
      {/* 分区页签：点击上方按钮切换到对应设置项，一次只显示一个区块 */}
      <Tabs defaultValue="sec-general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sec-general">常规</TabsTrigger>
          <TabsTrigger value="sec-storage">存储设置</TabsTrigger>
          <TabsTrigger value="sec-mail">邮件配置</TabsTrigger>
          <TabsTrigger value="sec-redis">Redis 缓存</TabsTrigger>
          <TabsTrigger value="sec-backup">备份与还原</TabsTrigger>
        </TabsList>

        <TabsContent value="sec-general">
      <Card className="cv-auto">
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
            <Label htmlFor="max-mb">图片上传上限（MB）</Label>
            <Input
              id="max-mb"
              type="number"
              min={1}
              max={512}
              value={maxMbInput}
              onChange={(e) => setMaxMbInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">仅限制图片；视频不设单文件上限（仍受用户存储配额约束）</p>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} 保存设置
          </Button>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="sec-mail">
      <Card className="cv-auto">
        <CardHeader>
          <CardTitle className="text-base">邮件配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 连接状态徽标：服务端即时探测（真实连接 + 认证握手，不发信），随页面打开/保存/手动检测刷新 */}
          {mail && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  mail.status === "connected"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : mail.status === "error"
                      ? "bg-red-500/15 text-red-600 dark:text-red-400"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {mail.status === "connected"
                  ? "已连接 · SMTP 配置可用"
                  : mail.status === "error"
                    ? "连接失败"
                    : "未配置 · 填写并保存后可检测"}
              </span>
              {mail.status === "error" && mail.error && (
                <span className="max-w-md truncate text-xs text-muted-foreground" title={mail.error}>
                  {mail.error}
                </span>
              )}
              {mail.status === "connected" && mail.host && (
                <span className="truncate text-xs text-muted-foreground">{mail.host}</span>
              )}
            </div>
          )}
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
            <PasswordInput
              id="smtp-pass"
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
            <Button variant="outline" onClick={refreshMail} disabled={mailChecking} title="重新探测当前连接状态（不发信）">
              {mailChecking ? <Loader2 className="animate-spin" /> : null} 检测连接
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">测试邮件只发送至超级管理员邮箱，需先保存配置；「检测连接」不发信，只验证连通与认证。</p>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="sec-redis">
      <Card className="cv-auto">
        <CardHeader>
          <CardTitle className="text-base">Redis 缓存（可选）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="redis-enabled">启用 Redis</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">开启后 Redis 负责两件事：接口限流 + 公开图片直链缓存（外链/缩略图免查库直出，减少数据库压力）；关闭时自动降级进程内存，功能不受影响</p>
            </div>
            <Switch
              id="redis-enabled"
              checked={form.redisEnabled}
              onCheckedChange={(v) => setForm({ ...form, redisEnabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="redis-url">Redis 连接地址</Label>
            <Input
              id="redis-url"
              type="password"
              autoComplete="off"
              placeholder={
                form.hasRedisUrl
                  ? "已保存（密码已加密存储，输入新地址可更换）"
                  : "redis://default:密码@主机:6379（Docker 同栈填 redis://redis:6379）"
              }
              value={form.redisUrl}
              onChange={(e) => setForm({ ...form, redisUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {form.hasRedisUrl ? "已存地址不下发浏览器，留空保存即保持不变；" : ""}
              留空回退环境变量 REDIS_URL；修改后点「保存配置」生效，无需重启站点。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {redis && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  redis.status === "connected"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : redis.status === "error"
                      ? "bg-red-500/15 text-red-600 dark:text-red-400"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {redis.status === "connected"
                  ? "已连接 · 限流与直链缓存走 Redis"
                  : redis.status === "error"
                    ? "连接失败 · 已降级内存"
                    : redis.enabled
                      ? "已启用 · 未连接"
                      : "未启用 · 限流与缓存走内存"}
              </span>
            )}
            {redis?.url && <span className="truncate text-xs text-muted-foreground">{redis.url}</span>}
            <Button size="sm" onClick={saveRedis} disabled={redisSaving}>
              {redisSaving ? <Loader2 className="animate-spin" /> : null} 保存配置
            </Button>
            <Button variant="outline" size="sm" onClick={() => testRedis(false)} disabled={redisTesting}>
              {redisTesting ? <Loader2 className="animate-spin" /> : null} 测试当前配置
            </Button>
            <Button variant="outline" size="sm" onClick={() => testRedis(true)} disabled={redisTesting || !form.redisUrl.trim()}>
              {redisTesting ? <Loader2 className="animate-spin" /> : null} 测试上方地址
            </Button>
          </div>
          {redis?.status === "error" && redis.error && <p className="text-xs text-destructive">{redis.error}</p>}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="sec-storage">
      <Card className="cv-auto">
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
              <option value="local">本地磁盘（存放在服务器上）</option>
              <option value="r2">对象存储（R2 / OSS / COS / MinIO…，不占用服务器空间）</option>
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

          {/* 存储对账：双向核对网站记录与桶内对象 */}
          <div className="space-y-3 border-t pt-4">
            <Label>存储对账</Label>
            <p className="text-xs text-muted-foreground">
              双向核对网站记录与桶内文件：① 网站有记录但桶里没有文件，可清理残留记录；
              ② 桶里有文件但网站已无记录（例如删除照片后残留），可自行决定保留或从桶内删除。
              清理前请确认上方桶配置与当初写入的桶一致。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={checkStorage} disabled={rc.running || orphan.running}>
                {rc.running || orphan.running ? <Loader2 className="size-4 animate-spin" /> : null} 开始核对
              </Button>
              {(rc.result || orphan.result) && (
                <Button variant="ghost" onClick={() => setResultOpen(true)}>
                  查看核对结果
                </Button>
              )}
              {rc.result && (
                <span className="text-xs text-muted-foreground">网站缺文件 {rc.result.missing} 条</span>
              )}
              {orphan.result && (
                <span className="text-xs text-muted-foreground">桶内多余 {orphan.result.total} 个</span>
              )}
            </div>

            {/* 核对结果：大弹窗内以图片网格展示两侧差异 */}
            <Dialog open={resultOpen} onOpenChange={setResultOpen}>
              <DialogContent className="flex max-h-[88vh] w-[96vw] max-w-7xl flex-col gap-3">
                <DialogHeader>
                  <DialogTitle>存储对账结果</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {orphan.result && orphan.result.slots === 0 && (
                    <p className="rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                      当前没有已配置完整（桶名 + 密钥 + 端点）的对象存储桶，无法读取桶内文件，因此这里不会有图片。
                      请先在上方「存储设置」填写并保存桶配置，再重新核对；若历史记录指向已移除的桶，会显示为「无法校验」。
                    </p>
                  )}

                  {/* 左右两方择一：点哪边就展示哪边的图片 */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSide("missing")}
                      className={`rounded-lg p-3 text-left transition ${
                        side === "missing" ? "border-2 border-primary bg-muted/40" : "border border-border hover:bg-muted/40"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">网站有记录、桶里没文件</span>
                        {side === "missing" && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </span>
                      <p className="mt-1 text-2xl font-bold">
                        {rc.result?.missing ?? 0}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">条</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        共校验 {rc.result?.checked ?? 0} 条 · 无法校验 {rc.result?.unconfigured ?? 0} 条
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSide("orphan")}
                      className={`rounded-lg p-3 text-left transition ${
                        side === "orphan" ? "border-2 border-primary bg-muted/40" : "border border-border hover:bg-muted/40"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">桶内有文件、网站没记录</span>
                        {side === "orphan" && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </span>
                      <p className="mt-1 text-2xl font-bold">
                        {orphan.result?.total ?? 0}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">个</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">桶内对象 {orphan.result?.objects ?? 0} 个</p>
                    </button>
                  </div>

                  {/* 左侧内容：网站有记录、桶里没文件 */}
                  {side === "missing" ? (
                    <section className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          勾选后可「移入桶内」；桶里确实缺失的记录也可直接清理。
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rc.running || leftList.length === 0}
                            onClick={() =>
                              setMissingPicked(
                                missingPicked.size >= leftList.length
                                  ? new Set()
                                  : new Set(leftList.map((it) => it.id))
                              )
                            }
                          >
                            {leftList.length > 0 && missingPicked.size >= leftList.length ? "取消全选" : "全选"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={moveMissingToBucket}
                            disabled={moving || missingPicked.size === 0}
                            title={bucketTarget ? `移入 ${bucketTarget}` : "请先配置对象存储桶"}
                          >
                            {moving ? <Loader2 className="size-4 animate-spin" /> : null} 移入桶内（{missingPicked.size}）
                          </Button>
                          {rc.result && rc.result.missing > 0 && (
                            <Button size="sm" variant="destructive" onClick={cleanR2} disabled={rc.running}>
                              清理 {rc.result.missing} 条缺失记录
                            </Button>
                          )}
                        </div>
                      </div>
                      {rc.result && leftList.length === 0 && (
                        <p className="text-xs text-muted-foreground">没有相关记录。</p>
                      )}
                      {leftPageItems.length > 0 && (
                        <>
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10">
                            {leftPageItems.map((it) => (
                              <ResultCard
                                key={it.id}
                                src={`/api/images/${it.id}/thumb`}
                                title={it.filename}
                                meta={`${it.ownerName ?? "未知"} · ${formatBytes(it.size)} · ${shortDate(it.createdAt)}`}
                                badge={missingIdSet.has(it.id) ? "缺失" : "未校验"}
                                checked={missingPicked.has(it.id)}
                                onToggle={() =>
                                  setMissingPicked((s) => {
                                    const next = new Set(s);
                                    if (next.has(it.id)) next.delete(it.id);
                                    else next.add(it.id);
                                    return next;
                                  })
                                }
                              />
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                            <Button size="sm" variant="outline" disabled={missingPage <= 1} onClick={() => setMissingPage((p) => p - 1)}>
                              上一页
                            </Button>
                            <span>
                              {missingPage} / {leftPages} · 共 {leftList.length} 项
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={missingPage >= leftPages}
                              onClick={() => setMissingPage((p) => p + 1)}
                            >
                              下一页
                            </Button>
                          </div>
                        </>
                      )}
                      {rc.result && rc.result.unconfigured > 0 && (
                        <p className="text-xs text-amber-600">
                          其中 {rc.result.unconfigured} 条指向未配置的桶，原图无法读取；补全桶配置后重新核对即可。
                        </p>
                      )}
                    </section>
                  ) : (
                    /* 右侧内容：桶里有文件、网站没记录 */
                    <section className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          勾选后可「移入网站」（下载到本地并收录为图片），也可直接从桶内删除。
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={orphan.running || orphanList.length === 0}
                            onClick={() =>
                              setOrphanPicked(
                                orphanPicked.size >= orphanList.length
                                  ? new Set()
                                  : new Set(orphanList.map((it) => orphanKey(it.slot, it.key)))
                              )
                            }
                          >
                            {orphanList.length > 0 && orphanPicked.size >= orphanList.length ? "取消全选" : "全选"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={adoptOrphans}
                            disabled={adopting || orphanPicked.size === 0}
                          >
                            {adopting ? <Loader2 className="size-4 animate-spin" /> : null} 移入网站（{orphanPicked.size}）
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={deleteOrphans}
                            disabled={orphan.running || orphanPicked.size === 0}
                          >
                            删除选中（{orphanPicked.size}）
                          </Button>
                        </div>
                      </div>
                      {orphan.result && orphan.result.errors.length > 0 && (
                        <p className="text-xs text-amber-600">部分存储读取失败：{orphan.result.errors.join("；")}</p>
                      )}
                      {orphan.result && orphan.result.truncated && (
                        <p className="text-xs text-muted-foreground">
                          仅列出最近 {orphan.result.items.length} 个，可分批处理后再核对。
                        </p>
                      )}
                      {orphanPageItems.length > 0 ? (
                        <>
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10">
                            {orphanPageItems.map((it) => {
                              const id = orphanKey(it.slot, it.key);
                              return (
                                <ResultCard
                                  key={id}
                                  src={`/api/admin/storage/orphans/preview?slot=${encodeURIComponent(it.slot)}&key=${encodeURIComponent(it.key)}`}
                                  title={it.key.split("/").pop() ?? it.key}
                                  meta={`${it.label} · ${formatBytes(it.size)} · ${shortDate(it.lastModified)}`}
                                  checked={orphanPicked.has(id)}
                                  onToggle={() =>
                                    setOrphanPicked((s) => {
                                      const next = new Set(s);
                                      if (next.has(id)) next.delete(id);
                                      else next.add(id);
                                      return next;
                                    })
                                  }
                                />
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                            <Button size="sm" variant="outline" disabled={orphanPage <= 1} onClick={() => setOrphanPage((p) => p - 1)}>
                              上一页
                            </Button>
                            <span>
                              {orphanPage} / {orphanPages} · 共 {orphanList.length} 项
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={orphanPage >= orphanPages}
                              onClick={() => setOrphanPage((p) => p + 1)}
                            >
                              下一页
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">桶内没有多余文件。</p>
                      )}
                    </section>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* R2 实时同步：独立子组件（自带 10s 轮询），状态更新只重渲染本面板，不拖累整页长表单 */}
          <SyncStatusPanel />
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="sec-backup">
      <Card className="cv-auto">
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
        </TabsContent>
      </Tabs>

      {/* 操作日志弹窗：独立按钮打开（每页 10 条，翻页查看） */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>操作日志</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <AdminLogsClient hideHeader />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
