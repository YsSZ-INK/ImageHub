"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisibilityBadge } from "@/components/image-actions";
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

// 图片审核：全站图片，可下架/彻底删除
export function AdminImagesClient() {
  const [items, setItems] = useState<AdminImage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (reset = true) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (!reset && cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/admin/images?${params}`);
        const json = await res.json();
        if (json.ok) {
          setItems((prev) => (reset ? json.data.items : [...prev, ...json.data.items]));
          setCursor(json.data.nextCursor);
        } else toast.error(json.error);
      } finally {
        setLoading(false);
      }
    },
    [cursor]
  );

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function takedown(id: string) {
    if (!confirm("下架该图片？其可见性将改为私有。")) return;
    const res = await fetch(`/api/admin/images/${id}`, { method: "PATCH" });
    const json = await res.json();
    if (json.ok) {
      toast.success("已下架");
      load(true);
    } else toast.error(json.error);
  }

  async function purge(id: string) {
    if (!confirm("彻底删除该图片？不可恢复！")) return;
    const res = await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      toast.success("已彻底删除");
      load(true);
    } else toast.error(json.error);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">图片审核</h1>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无图片</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((img) => (
            <div key={img.id} className="overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbUrl} alt={img.filename} loading="lazy" className="aspect-video w-full bg-muted object-cover" />
              <div className="space-y-1.5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{img.filename}</p>
                  <VisibilityBadge visibility={img.visibility} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {img.ownerName} · {formatBytes(img.size)} · {shortDate(img.createdAt)}
                </p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => takedown(img.id)}>
                    <EyeOff className="h-3 w-3" /> 下架
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => purge(img.id)}>
                    <Trash2 className="h-3 w-3" /> 删除
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {cursor && (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={() => load(false)} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null} 加载更多
          </Button>
        </div>
      )}
    </div>
  );
}
