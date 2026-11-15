import { handle, ok } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { measureR2Latency } from "@/lib/storage/r2";
import { slotConfigured } from "@/lib/markers";

export const runtime = "nodejs";

// 各存储桶读路径延迟（仅管理员）：并发 HEAD 探测，返回每个已配置槽位的往返毫秒。
// 只在后台存储设置页读取；正常上传/回源路径不做额外探测。
export const GET = handle(async () => {
  await requireApiSuper();
  const s = await getSettings();
  const slots = await Promise.all(
    s.r2Slots.map(async (cfg, index) => {
      if (!cfg.accessKeyId || !cfg.secretAccessKey || !slotConfigured(cfg)) {
        return { index, latencyMs: null as number | null };
      }
      try {
        return { index, latencyMs: await measureR2Latency(cfg) };
      } catch {
        return { index, latencyMs: null as number | null };
      }
    })
  );
  return ok({ slots });
});
