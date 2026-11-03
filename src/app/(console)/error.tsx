"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// 控制台路由组错误边界：页面渲染/水合失败时给出可读提示与重试，
// 而不是整片界面「看起来在、但点什么都没反应」
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[console]", error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <h2 className="text-base font-semibold">页面加载出错了</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        通常是部署更新后浏览器还持有旧版脚本导致的。先刷新页面；仍然不行再点下面的重试。
      </p>
      <p className="mt-2 break-all text-xs text-muted-foreground/80">{error.message}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={() => reset()}>重试</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          刷新页面
        </Button>
      </div>
    </div>
  );
}
