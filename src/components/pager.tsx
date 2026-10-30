"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// 翻页条：上一页 / 下一页 + 输入页码跳转（回车或点「跳转」）
export function Pager({
  page,
  hasNext,
  disabled,
  onGo,
}: {
  page: number;
  hasNext: boolean;
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
          type="number"
          min={1}
          aria-label="页码"
          className="h-8 w-14 text-center"
          placeholder={String(page)}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <span>页</span>
      </form>
      <Button variant="outline" size="sm" disabled={disabled || !hasNext} onClick={() => onGo(page + 1)}>
        下一页
      </Button>
    </div>
  );
}
