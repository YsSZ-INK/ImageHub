"use client";

import { User as UserIcon } from "lucide-react";

// 头像：无图时显示首字母
export function AvatarFallbackIcon({
  name,
  url,
  size = 32,
}: {
  name: string;
  url: string | null;
  size?: number;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full bg-muted text-foreground/70 font-medium"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {name ? name.slice(0, 1).toUpperCase() : <UserIcon className="h-3 w-3" />}
    </span>
  );
}
