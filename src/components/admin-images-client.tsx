"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/pager";
import { formatBytes, shortDate } from "@/lib/utils";

type AdminImage = {
  id: string;
  filename: string;
  visibility: string;
  size: number;
  mimeType: string;
  createdAt: string;
  thumbUrl: string;
  ownerName: string;
  ownerEmail: string;
};

// 图片审核：待审核队列（先传先审），通过后进入画廊；可彻底删除
export function AdminImagesClient() {
  const [items, setItems] = useState<AdminImage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/images?page=${p}`);
      const json = await res.json();
      if (json.ok) {
        setItems(json.data.items);
        setPage(json.data.page);
        setTotalPages(json.data.totalPages);
        setTotal(json.data.total);
      } else toast.error(json.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  async function approve(id: string) {
    setActing(id);
    try {
      const res = await fetch(`/api/admin/images/${id}`, { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        toast.success("已通过审核，图片进入画廊");
        load(page);
      } else toast.error(json.error);
    } finally {
      setActing(null);
    }
  }

  async function purge(id: string) {
    if (!confirm("彻底删除该图片？不可恢复！")) return;
    setActing(id);
    try {
      const res = await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        toast.success("已彻底删除");
        load(page);
      } else toast.error(json.error);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">图片审核</h1>
        {total > 0 && <span className="text-sm text-muted-foreground">待审核 {total} 张</span>}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无待审核图片，用户上传的图片会出现在这里</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((img) => (
            <div key={img.id} className="overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbUrl} alt={img.filename} loading="lazy" className="aspect-video w-full bg-muted object-cover" />
              <div className="space-y-1.5 p-2.5">
                <p className="truncate text-sm font-medium">{img.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {img.ownerName} · {formatBytes(img.size)} · {shortDate(img.createdAt)}
                </p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" disabled={acting === img.id} onClick={() => approve(img.id)}>
                    {acting === img.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} 通过
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={acting === img.id} onClick={() => purge(img.id)}>
                    <Trash2 className="h-3 w-3" /> 删除
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-auto">
          <Pager page={page} hasNext={page < totalPages} disabled={loading} onGo={(p) => load(p)} />
        </div>
      )}
    </div>
  );
}
