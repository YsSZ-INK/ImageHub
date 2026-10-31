"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageDTO } from "@/server/image.service";

// 游标分页 hook：pageCursors[i] = 请求第 i+1 页所需的 cursor（首页为 null）。
// loadPage 上一页/下一页/刷新；gotoPage 支持跳转任意页——
// 从已缓存的最远游标逐页前进收集游标直到目标页，目标超出实际页数时回落到最后的非空页。
export function useCursorPager(
  params: Record<string, string | undefined>,
  opts?: { initialItems?: ImageDTO[]; initialCursor?: string | null }
) {
  const [items, setItems] = useState<ImageDTO[]>(opts?.initialItems ?? []);
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null, opts?.initialCursor ?? null]);
  const [hasNext, setHasNext] = useState(!!opts?.initialCursor);
  // 服务端已渲染首屏时初始无需 loading
  const [loading, setLoading] = useState(!opts?.initialItems);
  // 序列化为稳定依赖，避免调用方传入对象字面量导致每次渲染重建回调
  const key = JSON.stringify(params);

  function buildQuery(cursors: (string | null)[], target: number) {
    const sp = new URLSearchParams();
    const parsed: Record<string, string> = JSON.parse(key);
    for (const [k, v] of Object.entries(parsed)) if (v) sp.set(k, v);
    const c = cursors[target - 1];
    if (c) sp.set("cursor", c);
    return sp;
  }

  const loadPage = useCallback(
    async (target: number) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/images?${buildQuery(pageCursors, target)}`);
        const json = await res.json();
        if (json.ok) {
          // 当前页被删空且不是第一页时，回退一页
          if (json.data.items.length === 0 && target > 1) {
            setPageCursors((prev) => prev.slice(0, target));
            setLoading(false);
            return loadPage(target - 1);
          }
          setItems(json.data.items);
          setPage(target);
          setHasNext(!!json.data.nextCursor);
          if (json.data.nextCursor) {
            setPageCursors((prev) => {
              const nx = [...prev];
              nx[target] = json.data.nextCursor;
              return nx;
            });
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          toast.error(json.error);
        }
      } finally {
        setLoading(false);
      }
    },
    [key, pageCursors]
  );

  // 跳页：目标页已有缓存游标时直达，否则从最远已知位置逐页前进
  const gotoPage = useCallback(
    async (target: number) => {
      target = Math.max(1, Math.floor(target) || 1);
      if (target === page) return;
      setLoading(true);
      try {
        let cursors = pageCursors;
        const fetchJson = async (p: number) => {
          const res = await fetch(`/api/images?${buildQuery(cursors, p)}`);
          const json = await res.json();
          if (!json.ok) {
            toast.error(json.error);
            return null;
          }
          if (json.data.nextCursor) {
            cursors = [...cursors];
            cursors[p] = json.data.nextCursor;
            setPageCursors(cursors);
          }
          return json;
        };
        for (let p = pageCursors.length; p < target; p++) {
          const json = await fetchJson(p);
          if (!json) return;
          if (json.data.items.length === 0) {
            // 跳转目标超出实际页数：截断游标栈，回落到最后的非空页
            setPageCursors(cursors.slice(0, p));
            if (p > 1) {
              setLoading(false);
              return loadPage(p - 1);
            }
            return;
          }
          // 已到最后一页（无下一页游标）：p 即实际最后一页
          if (!cursors[p]) {
            setLoading(false);
            return loadPage(p);
          }
        }
        setLoading(false);
        return loadPage(target);
      } finally {
        setLoading(false);
      }
    },
    [key, pageCursors, page]
  );

  // 无服务端首屏数据时，挂载后加载第一页
  const mounted = useRef(false);
  useEffect(() => {
    if (!opts?.initialItems) loadPage(1);
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 查询参数变化（如筛选条件切换）→ 回到第一页重新加载
  useEffect(() => {
    if (!mounted.current) return; // 首次挂载由上面的 effect 负责，避免重复请求
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { items, page, hasNext, loading, loadPage, gotoPage };
}
