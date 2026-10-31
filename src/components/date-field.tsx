"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Seg = { y: string; m: string; d: string };

const KEYS = ["y", "m", "d"] as const;
const fmt = (s: Seg) => (s.y && s.m && s.d ? `${s.y}-${s.m}-${s.d}` : "");

function valid(s: Seg): boolean {
  if (s.y.length !== 4 || s.m.length !== 2 || s.d.length !== 2) return false;
  const y = Number(s.y), mo = Number(s.m), d = Number(s.d);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

// 自定义分段日期输入：年 / 月 / 日 三段，点击某段后逐位键入数字，输满自动跳下一段；
// 不弹浏览器日历面板；正在输入的段蓝底白字高亮
export function DateField({
  value,
  onChange,
  className,
}: {
  value: string; // YYYY-MM-DD，空串表示未选
  onChange: (v: string) => void;
  className?: string;
}) {
  const [seg, setSeg] = useState<Seg>(() =>
    value ? { y: value.slice(0, 4), m: value.slice(5, 7), d: value.slice(8, 10) } : { y: "", m: "", d: "" }
  );
  const [focus, setFocus] = useState(-1);
  const emitted = useRef<string | null>(null);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  // 外部值变化（快捷区间 / 清除按钮）→ 重建分段
  useEffect(() => {
    if (emitted.current === value) return;
    setSeg(value ? { y: value.slice(0, 4), m: value.slice(5, 7), d: value.slice(8, 10) } : { y: "", m: "", d: "" });
  }, [value]);

  function setSegAt(i: number, digits: string) {
    const next = { ...seg, [KEYS[i]]: digits };
    setSeg(next);
    if (valid(next)) {
      const v = fmt(next);
      emitted.current = v;
      onChange(v);
    }
  }

  function onInput(i: number, raw: string) {
    const maxLen = i === 0 ? 4 : 2;
    const clipped = raw.replace(/\D/g, "").slice(0, maxLen);
    setSegAt(i, clipped);
    // 段满（年 4 位 / 月日 2 位）自动跳到下一段
    if (clipped.length === maxLen && i < 2) refs[i + 1].current?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && e.currentTarget.value === "" && i > 0) {
      e.preventDefault();
      refs[i - 1].current?.focus();
      const prev = seg[KEYS[i - 1]];
      if (prev) setSegAt(i - 1, prev.slice(0, -1));
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs[i - 1].current?.focus();
    } else if (e.key === "ArrowRight" && i < 2) {
      e.preventDefault();
      refs[i + 1].current?.focus();
    }
  }

  const segCls = (i: number) =>
    cn(
      "h-full w-9 bg-transparent text-center text-base tabular-nums outline-none placeholder:text-muted-foreground/50",
      i === 0 && "w-14",
      focus === i && "rounded bg-blue-600 text-white placeholder:text-white/70"
    );

  return (
    <div
      className={cn(
        "inline-flex h-11 items-center gap-0.5 rounded-md border border-border bg-background/60 px-2 shadow-sm backdrop-blur-sm transition-all hover:border-foreground/25",
        focus >= 0 && "border-ring ring-2 ring-ring/25",
        className
      )}
    >
      <input
        ref={refs[0]}
        className={segCls(0)}
        inputMode="numeric"
        placeholder="年"
        value={seg.y}
        onFocus={(e) => { setFocus(0); e.currentTarget.select(); }}
        onBlur={() => setFocus(-1)}
        onChange={(e) => onInput(0, e.target.value)}
        onKeyDown={(e) => onKeyDown(0, e)}
        aria-label="年"
      />
      <span className="text-muted-foreground">/</span>
      <input
        ref={refs[1]}
        className={segCls(1)}
        inputMode="numeric"
        placeholder="月"
        value={seg.m}
        onFocus={(e) => { setFocus(1); e.currentTarget.select(); }}
        onBlur={() => setFocus(-1)}
        onChange={(e) => onInput(1, e.target.value)}
        onKeyDown={(e) => onKeyDown(1, e)}
        aria-label="月"
      />
      <span className="text-muted-foreground">/</span>
      <input
        ref={refs[2]}
        className={segCls(2)}
        inputMode="numeric"
        placeholder="日"
        value={seg.d}
        onFocus={(e) => { setFocus(2); e.currentTarget.select(); }}
        onBlur={() => setFocus(-1)}
        onChange={(e) => onInput(2, e.target.value)}
        onKeyDown={(e) => onKeyDown(2, e)}
        aria-label="日"
      />
    </div>
  );
}
