"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// 翻页条：上一页 / 下一页 + 输入页码跳转（回车或点「跳转」）
export function Pager({
  page,
  hasNext,
  totalPages,
  disabled,
  onGo,
}: {
  page: number;
  hasNext: boolean;
  totalPages?: number | null;
  disabled?: boolean;
  onGo: (target: number) => void;
}) {
  const [input, setInput] = useState("");
  const n = Math.floor(Number(input));
  const canJump = !disabled && Number.isFinite(n) && n >= 1 && n !== page;
  return (
    <div className="flex items-center justify-center gap-3 py-4">
      <Button variant="outline" size="sm" disabled={disabled || page === 1} onClick={() => onGo(page - 1)}>
        上一页
      </Button>
      <form
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        onSubmit={(e) => {
          e.preventDefault();
          if (canJump) {
            onGo(n);
            setInput("");
          }
        }}
      >
        <span>第</span>
        <Input
          type="text"
          inputMode="numeric"
          aria-label="页码"
          className="h-8 w-14 text-center"
          placeholder={String(page)}
          value={input}
          maxLength={4}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
          onFocus={(e) => {
            // 点入时预填当前页码并把光标置于数字后，可直接续输或退格修改
            const el = e.currentTarget;
            setInput(String(page));
            requestAnimationFrame(() => {
              const len = el.value.length;
              try {
                el.setSelectionRange(len, len);
              } catch {
                // 部分浏览器不支持 selection，忽略
              }
            });
          }}
        />
        <span>页</span>
      </form>
      {totalPages ? <span className="whitespace-nowrap text-muted-foreground">共 {totalPages} 页</span> : null}
      <Button variant="outline" size="sm" disabled={disabled || !hasNext} onClick={() => onGo(page + 1)}>
        下一页
      </Button>
    </div>
  );
}
