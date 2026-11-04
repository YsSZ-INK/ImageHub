import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | bigint | string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function shortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("zh-CN");
}

/**
 * 站内链接构造器 —— 严格私有模式：
 * 所有复制内容只指向需要登录的站内页面，绝不指向匿名图片直链。
 */
export function buildSnippets(imageId: string, filename: string, siteUrl: string) {
  const pageUrl = `${siteUrl.replace(/\/$/, "")}/images/${imageId}`;
  return {
    pageUrl,
    thumbRoute: `/api/images/${imageId}/thumb`,
    markdown: `[${filename}](${pageUrl})`,
    html: `<a href="${pageUrl}">${filename}</a>`,
    bbcode: `[url=${pageUrl}]${filename}[/url]`,
  };
}

// 原图预加载（浏览器缓存级去重）：画廊卡片 hover 与灯箱翻页时预取，
// 让点击/切换时原图已在缓存中，点开即显示高清原图
const preloaded = new Set<string>();

export function preloadRaw(url: string) {
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.src = url;
}

// 缩略图路由支持 ?w= 四档宽度：交给浏览器按屏宽自动挑最小够用的一档，省流量也更快出图
export function thumbSrcSet(url: string) {
  return [400, 800, 1600].map((w) => `${url}&w=${w} ${w}w`).join(", ");
}

// 等比方格网格（2/4/6 列）与瀑布流（2/3/4/5 列）的实际显示宽度，供 srcset 选档
export const GRID_SIZES = "(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 50vw";
export const MASONRY_SIZES = "(min-width: 1536px) 19vw, (min-width: 1024px) 24vw, (min-width: 640px) 33vw, 50vw";

// 首屏前几张不懒加载，避免「缩略图先等着」的观感；其余继续 lazy
export const EAGER_COUNT = 8;

// 视频卡片封面：手机（尤其 iOS Safari）不会为 preload="metadata" 的视频绘制首帧，
// 加媒体片段 #t=0.5 让浏览器定位到第 0.5 秒并渲染该帧，充当封面
export function videoCoverSrc(url: string) {
  return url.includes("#") ? url : `${url}#t=0.5`;
}
