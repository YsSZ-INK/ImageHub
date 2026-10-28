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
