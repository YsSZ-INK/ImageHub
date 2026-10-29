import { redirect } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";
import { Lock, Images, Upload, ShieldCheck, Brush } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { AuthForm } from "@/components/auth-form";
import { ThemeToggle } from "@/components/theme-toggle";

// 宣纸噪点纹理（内联 SVG，无外部请求）
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const FEATURES = [
  { icon: Lock, text: "图片严格私有，所有访问需登录" },
  { icon: Images, text: "相册 · 瀑布流画廊" },
  { icon: Upload, text: "拖拽 / 粘贴上传，自动缩略图" },
  { icon: ShieldCheck, text: "管理后台与开放 API" },
];

// 水墨背景图池：每次进入登录页随机一幅
const BG_IMAGES = ["/ink-1.png", "/ink-2.png", "/ink-3.png", "/ink-4.png"];

// 首页即登录/注册页（已登录自动跳 /gallery，由中间件完成）
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/gallery");
  const settings = await getSettings();
  // 登录页每次进入随机一幅（登录后页面仍按 ink-bg cookie 会话固定）
  const idx = Math.floor(Math.random() * BG_IMAGES.length);
  const bg = BG_IMAGES[idx];

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* ===== 背景层：水墨画真图（随机一幅）+ 透明遮罩 + 纸纹 ===== */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <Image src={bg} alt="" fill priority sizes="100vw" className="object-cover" />
        {/* 透明遮罩：亮色留白提亮 / 暗色压暗，保证前景可读 */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/45 via-transparent to-white/60 dark:from-black/55 dark:via-black/25 dark:to-black/70" />
        {/* 宣纸纹理 */}
        <div
          className="absolute inset-0 opacity-[0.04] mix-blend-multiply dark:mix-blend-screen"
          style={{ backgroundImage: NOISE }}
        />
      </div>

      {/* 主题切换 */}
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      {/* 左缘竖排题款（大屏装饰，利用左侧留白） */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[max(1rem,calc(50vw-38rem))] top-1/2 z-10 hidden -translate-y-1/2 select-none flex-col items-center gap-4 xl:flex"
      >
        <span className="h-16 w-px bg-foreground/15" />
        <span className="text-sm tracking-[0.35em] text-muted-foreground [writing-mode:vertical-rl]">
          墨落无声 · 照片有主
        </span>
        <span className="flex h-8 w-8 -rotate-2 items-center justify-center rounded-[3px] bg-seal text-sm font-bold text-seal-foreground shadow-sm ring-1 ring-seal/30">
          私
        </span>
        <span className="h-16 w-px bg-foreground/15" />
      </div>

      {/* ===== 主体两栏 ===== */}
      <div className="mx-auto grid w-full flex-1 items-center gap-10 px-4 py-10 sm:px-8 md:max-w-[min(90vw,68rem)] md:grid-cols-[1.05fr_0.95fr] md:gap-12 md:px-8 lg:gap-24 lg:px-12">
        {/* ---- 品牌区 ---- */}
        <section className="order-2 md:order-1">
          {/* 移动端：居中品牌行 */}
          <div className="flex flex-col items-center gap-3 text-center md:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/5 ring-1 ring-foreground/15">
              <Brush className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold">{settings.siteName}</h1>
            <p className="text-sm text-muted-foreground">私有图床 · 全站内容仅登录用户可见</p>
          </div>

          {/* 大屏：Logo 行 + 主标语 + 描述 + 特性网格（自然高度） */}
          <div className="hidden md:block">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/5 ring-1 ring-foreground/15">
                <Brush className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">{settings.siteName}</h1>
            </div>

            <div className="mt-10">
              <p className="font-display text-[clamp(1.875rem,3.5vw,3rem)] font-bold leading-tight tracking-wider">
                墨落无声，
                <br />
                照片有主。
              </p>
              <p className="mt-5 max-w-lg leading-relaxed text-muted-foreground">
                严格私有模式的图床：上传、整理、分享你的图片，每一次访问都需要登录，链接永不外泄。
              </p>
            </div>

            <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6">
              {FEATURES.map((f) => (
                <li
                  key={f.text}
                  className="flex items-center gap-4 rounded-xl border border-foreground/10 bg-background/50 p-5 backdrop-blur-sm transition-colors duration-200 hover:border-foreground/25 hover:bg-background/75"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-foreground/5 ring-1 ring-foreground/10">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <span className="text-[15px]">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- 登录卡片（自然高度，垂直居中） ---- */}
        <section className="order-1 mx-auto w-full max-w-md self-center md:order-2">
          <div className="rounded-2xl border border-foreground/10 bg-background/70 p-6 shadow-2xl shadow-foreground/10 backdrop-blur-xl sm:p-8">
            <h2 className="text-2xl font-semibold">欢迎回来</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {settings.allowRegister ? "登录或创建账号以继续" : "本站已关闭注册，请使用已有账号登录"}
            </p>
            <div className="mt-6">
              <Suspense>
                <AuthForm allowRegister={settings.allowRegister} />
              </Suspense>
            </div>
          </div>
        </section>
      </div>

      {/* ===== 底部版权（独立一行） ===== */}
      <footer className="relative z-10 pb-5 text-center text-xs text-muted-foreground">
        © 2026 {settings.siteName} · 严格私有模式
      </footer>
    </main>
  );
}
