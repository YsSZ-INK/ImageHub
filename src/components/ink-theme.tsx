// 水墨主题装饰组件：水墨图背景层 + 印章（后台/控制台共用）

import { cookies } from "next/headers";

// 宣纸噪点纹理（内联 SVG，无外部请求）
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// 与登录页同一批水墨图
const INK_BACKGROUNDS = ["/ink-1.png", "/ink-2.png", "/ink-3.png", "/ink-4.png"];

/** 页面背景：与登录页同一幅水墨图（由 middleware 经 ink-bg cookie 会话固定）+ 轻遮罩 + 纸纹 */
export async function InkBackdrop() {
  const store = await cookies();
  const idx = Number(store.get("ink-bg")?.value ?? 0);
  const src = INK_BACKGROUNDS[idx] ?? INK_BACKGROUNDS[0];

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      {/* 水墨背景图，全浓（同首页） */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${src})` }}
      />
      {/* 透明遮罩：亮色留白提亮 / 暗色压暗（同首页渐变） */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/45 via-transparent to-white/60 dark:from-black/55 dark:via-black/25 dark:to-black/70" />
      {/* 宣纸纹理 */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-multiply dark:mix-blend-screen"
        style={{ backgroundImage: NOISE }}
      />
    </div>
  );
}

/** 方形印章（朱砂印泥红，微倾模拟手工钤印） */
export function InkSeal({ char, className = "" }: { char: string; className?: string }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 -rotate-2 items-center justify-center rounded-[3px] bg-seal text-xs font-bold text-seal-foreground shadow-sm ring-1 ring-seal/30 ${className}`}
    >
      {char}
    </span>
  );
}
