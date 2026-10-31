"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderInput, Film, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/controls";
import { formatBytes } from "@/lib/utils";
import { markerLabel, markerBadgeClass } from "@/lib/markers";
import type { MigrationStatus } from "@/server/migration.service";

export type MarkerOpt = { marker: string; label: string };

type MItem = {
  id: string;
  filename: string;
  size: number;
  storage: string;
  thumbUrl: string;
  kind: "image" | "video";
};

const selectCls =
  "h-10 rounded-md border border-border bg-background/60 px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

// 存储迁移管理：选方向 → 逐张勾选（带存储徽标，看清到底迁哪些）→ 发起 → 进度
export function MigrateClient({ markers, initialStatus }: { markers: MarkerOpt[]; initialStatus: MigrationStatus }) {
  const [from, setFrom] = useState(markers[0]?.marker ?? "local");
  const [to, setTo] = useState(markers[1]?.marker ?? markers[0]?.marker ?? "");
  const [items, setItems] = useState<MItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  // 跨页保存勾选（id → 条目），翻页不丢
  const [checked, setChecked] = useState<Map<string, MItem>>(new Map());
  const [migrateAll, setMigrateAll] = useState(false); // 勾上表示迁移该位置全部图片
  const [status, setStatus] = useState<MigrationStatus>(initialStatus);
  const [starting, setStarting] = useState(false);
  const fromRef = useRef(from);

  const fromLabel = markerLabel(from);
  const toLabel = markerLabel(to);

  const load = useCallback(async (p: number, marker: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/storage/migrate/list?marker=${encodeURIComponent(marker)}&page=${p}`);
      const json = await res.json();
      if (json.ok) {
        setItems(json.data.items as MItem[]);
        setTotal(json.data.total);
        setPage(json.data.page);
        setPageCount(json.data.pageCount);
      } else toast.error(json.error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 源位置 / 页码变化 → 重新加载列表
  useEffect(() => {
    fromRef.current = from;
    if (from && to && from !== to) void load(1, from);
  }, [from, to, load]);

  // 迁移进行中每 2 秒轮询进度；结束后刷新列表
  useEffect(() => {
    if (!status.running) return;
    const t = setInterval(() => {
      fetch("/api/admin/storage/migrate")
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) return;
          const next = json.data as MigrationStatus;
          setStatus(next);
          if (!next.running) {
            toast.success(`迁移完成：成功 ${next.done - next.failed}，失败 ${next.failed}`);
            void load(1, fromRef.current);
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [status.running, load]);

  function toggle(id: string, item: MItem) {
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, item);
      return next;
    });
  }

  const allPageChecked = items.length > 0 && items.every((i) => checked.has(i.id));
  function toggleAllPage() {
    setChecked((prev) => {
      const next = new Map(prev);
      if (allPageChecked) for (const i of items) next.delete(i.id);
      else for (const i of items) next.set(i.id, i);
      return next;
    });
  }

  async function start() {
    if (from === to) {
      toast.error("源位置与目标位置相同");
      return;
    }
    if (!migrateAll && checked.size === 0) {
      toast.error("请先勾选要迁移的图片，或勾选「迁移全部」");
      return;
    }
    const count = migrateAll ? total : checked.size;
    const ok = window.confirm(
      `把 ${migrateAll ? "该位置全部" : ""} ${count} 张图片从「${fromLabel}」复制到「${toLabel}」？\n\n` +
        `完成后会删除源位置的文件；迁移期间请勿上传或删除图片。`
    );
    if (!ok) return;
    setStarting(true);
    try {
      const res = await fetch("/api/admin/storage/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, ...(migrateAll ? {} : { ids: [...checked.keys()] }) }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`迁移 ${fromLabel} → ${toLabel} 已开始`);
        setChecked(new Map());
        setMigrateAll(false);
        const st = await fetch("/api/admin/storage/migrate").then((r) => r.json());
        if (st.ok) setStatus(st.data as MigrationStatus);
      } else toast.error(json.error);
    } finally {
      setStarting(false);
    }
  }

  const running = status.running;

  return (
    <div className="space-y-4">
      {/* 方向与选择 */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <FolderInput className="h-5 w-5 text-muted-foreground" />
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">从</Label>
              <select className={selectCls} value={from} onChange={(e) => { setFrom(e.target.value); setChecked(new Map()); setMigrateAll(false); }}>
                {markers.map((m) => (
                  <option key={m.marker} value={m.marker}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">到</Label>
              <select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)}>
                {markers.map((m) => (
                  <option key={m.marker} value={m.marker}>{m.label}</option>
                ))}
              </select>
            </div>
            <span className="text-sm text-muted-foreground">
              该位置共 <b className="text-foreground">{total}</b> 张图片，逐张勾选要迁移的文件
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            迁移 = 复制到目标 → 更新记录 → 删除源位置文件。本地上传只进当前默认存储；
            本地已有照片<strong>不会</strong>自动上传到存储桶，只有在这里手动迁移才会。
            徽标：<span className={`mx-1 rounded px-1.5 py-0.5 text-xs ${markerBadgeClass("local")}`}>本地</span>
            表示本地磁盘，<span className={`mx-1 rounded px-1.5 py-0.5 text-xs ${markerBadgeClass("r2:0")}`}>R2</span>
            表示存储桶。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allPageChecked && items.length > 0} onCheckedChange={toggleAllPage} disabled={loading || items.length === 0} />
              全选本页（{items.length} 张）
            </label>
            {checked.size > 0 && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setChecked(new Map())}>
                清空勾选（{checked.size}）
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={migrateAll} onCheckedChange={(v) => setMigrateAll(v === true)} />
              迁移该位置全部 {total} 张（不限勾选）
            </label>
            <Button onClick={start} disabled={starting || running || from === to} className="ml-auto">
              {starting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              发起迁移{migrateAll ? `（全部 ${total} 张）` : checked.size > 0 ? `（已选 ${checked.size} 张）` : ""}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 迁移进度 */}
      {(running || status.finishedAt) && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center justify-between text-sm">
              <span>
                {running ? "迁移进行中：" : "上次迁移："}
                {status.direction?.split(">").map(markerLabel).join(" → ")}
              </span>
              <span className="text-muted-foreground">
                {status.done}/{status.total}{status.failed > 0 ? ` · 失败 ${status.failed}` : ""}
              </span>
            </div>
            <Progress value={status.total > 0 ? (status.done / status.total) * 100 : 0} />
            {status.errors.length > 0 && (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                {status.errors.map((e, i) => (
                  <p key={i} className="break-all">{e}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 图片列表（带存储徽标） */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              该位置没有图片
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {items.map((img) => {
                  const isChecked = checked.has(img.id);
                  return (
                    <label
                      key={img.id}
                      className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-colors ${
                        isChecked ? "border-primary ring-2 ring-primary/30" : "border-foreground/10 hover:border-foreground/25"
                      }`}
                    >
                      <div className="relative flex h-28 items-center justify-center bg-muted/40">
                        {img.kind === "video" ? (
                          <Film className="h-8 w-8 text-muted-foreground" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img.thumbUrl} alt={img.filename} className="h-full w-full object-cover" loading="lazy" />
                        )}
                        <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium ${markerBadgeClass(img.storage)}`}>
                          {markerLabel(img.storage)}
                        </span>
                        <span className="absolute right-1.5 top-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[0.6875rem] tabular-nums">
                          {formatBytes(img.size)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 p-2">
                        <Checkbox checked={isChecked} onCheckedChange={() => toggle(img.id, img)} />
                        <span className="truncate text-xs" title={img.filename}>{img.filename}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => void load(page - 1, from)}>
                  上一页
                </Button>
                <span>第</span>
                <Input
                  className="h-8 w-16 px-2 text-center text-sm tabular-nums"
                  defaultValue={page}
                  key={`${from}-${page}`}
                  inputMode="numeric"
                  onBlur={(e) => {
                    const t = Math.min(Math.max(Number(e.target.value) || 1, 1), pageCount);
                    e.target.value = String(t);
                    if (t !== page) void load(t, from);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                <span>/ {pageCount} 页 · 共 {total} 张</span>
                <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => void load(page + 1, from)}>
                  下一页
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
