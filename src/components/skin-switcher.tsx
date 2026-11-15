"use client";

import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 控制台皮肤切换：默认「水墨」，可切到全新的「云蓝」。
 * 皮肤仅通过 html.skin-azure 覆盖 CSS 变量与少量装饰实现（见 globals.css），
 * 不改动任何现有页面与组件结构；偏好存 localStorage，登录页不套用云蓝皮肤。
 */

type Skin = "ink" | "azure";

const SKIN_KEY = "console-skin";

const SKINS: { id: Skin; name: string; hint: string; dot: string }[] = [
  { id: "ink", name: "水墨", hint: "默认 · 宣纸与朱砂", dot: "bg-stone-800" },
  { id: "azure", name: "云蓝", hint: "全新 · 柔和天蓝", dot: "bg-sky-500" },
];

export function SkinSwitcher() {
  const [skin, setSkin] = useState<Skin>("ink");

  // 进入控制台后同步偏好（整页加载时由 layout 的启动脚本提前应用，避免闪色）
  useEffect(() => {
    const saved: Skin = localStorage.getItem(SKIN_KEY) === "azure" ? "azure" : "ink";
    setSkin(saved);
    document.documentElement.classList.toggle("skin-azure", saved === "azure");
  }, []);

  function choose(next: Skin) {
    setSkin(next);
    document.documentElement.classList.toggle("skin-azure", next === "azure");
    try {
      localStorage.setItem(SKIN_KEY, next);
    } catch {
      // 隐私模式禁用存储时只在当前页生效
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="切换界面主题"
          title="界面主题"
          className="text-stone-50 hover:bg-stone-800 hover:text-stone-50"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">界面主题</div>
        <DropdownMenuSeparator />
        {SKINS.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => choose(s.id)} className="gap-2">
            <span className={`h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10 ${s.dot}`} />
            <span className="flex flex-col">
              <span>{s.name}</span>
              <span className="text-[0.6875rem] text-muted-foreground">{s.hint}</span>
            </span>
            {skin === s.id && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
