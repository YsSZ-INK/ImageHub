import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiSuper } from "@/lib/session";
import { redisStatus, testRedisUrl, getRedis, getRedisNodes, resetRedisCooldown, refreshLatency } from "@/lib/redis";
import { getSettings, saveSettings, type RedisSlotConfig } from "@/lib/settings";
import { logActivity } from "@/server/audit.service";
import { z } from "zod";

export const runtime = "nodejs";

// 地址里的密码不进错误文案
function maskUrl(url: string): string {
  return url.replace(/\/\/[^@/]+@/, "//***@");
}

// 当前 Redis 连接状态（含槽位明细与开关状态）
export const GET = handle(async () => {
  await requireApiSuper();
  // 进程刚重启时模块状态还是旧值，先主动探一次，避免直接返回误报「未连接」
  await getRedis();
  // 顺带实测各节点 PING 延迟（只在后台设置页读状态时做，正常读写不额外 PING）
  await refreshLatency();
  const settings = await getSettings();
  return ok({
    ...redisStatus(),
    enabled: settings.redisEnabled,
    // 已保存的槽位元信息（地址本体不下发浏览器）
    configured: settings.redisSlots.map((s) => ({ id: s.id, label: s.label ?? "", hasUrl: !!s.url })),
  });
});

const testSchema = z.object({
  url: z.string().max(255).trim().optional(),
  index: z.number().int().min(0).max(4).optional(),
});

// 测试连接：三种入参
// { url }   测表单里还没保存的地址
// { index } 测服务端已保存的第 index 个槽位（地址不下发，只能后端测）
// {}        测当前生效连接
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await requireApiSuper();
  const body = testSchema.parse(await req.json().catch(() => ({})));

  if (body.url) return ok(await testRedisUrl(body.url));

  if (typeof body.index === "number") {
    const settings = await getSettings();
    const slot = settings.redisSlots[body.index];
    if (!slot?.url) return ok({ ok: false, message: "该地址为空（尚未保存）" });
    return ok(await testRedisUrl(slot.url));
  }

  const s = redisStatus();
  const nodes = getRedisNodes();
  if (nodes.length === 0) {
    const settings = await getSettings();
    const message = !settings.redisEnabled
      ? "Redis 开关未启用（限流走进程内存）"
      : s.slots.length === 0
        ? "未配置连接地址（限流走进程内存）"
        : `连接失败：${s.error || "全部地址不可用"}`;
    return ok({ ok: false, message });
  }
  const results = await Promise.all(nodes.map((c) => c.ping().then((p) => p === "PONG").catch(() => false)));
  const okCount = results.filter(Boolean).length;
  // 顺手刷新一遍延迟，测试完状态胶囊旁的耗时立刻更新
  await refreshLatency();
  return ok({
    ok: okCount > 0,
    message:
      s.mode === "balance"
        ? `${okCount}/${s.slots.length} 个实例同时分担读写`
        : "连接成功，限流与直链缓存已走 Redis",
  });
});

// 独立保存 Redis 配置（开关 + 模式 + 地址列表），不影响其他站点设置；保存后立即生效
const saveSchema = z.object({
  redisEnabled: z.boolean(),
  redisMode: z.enum(["failover", "balance"]).optional(),
  redisSlots: z
    .array(
      z.object({
        id: z.string().max(40).optional(),
        url: z.string().max(255),
        label: z.string().max(40).optional(),
      })
    )
    .max(5)
    .optional(),
  // 旧版单地址入参兼容
  redisUrl: z.string().max(255).trim().optional(),
});

export const PUT = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiSuper();
  const body = saveSchema.parse(await req.json());
  const current = await getSettings();

  // 槽位回填：留空表示保持原地址，必须按稳定 id 匹配（按下标会在增删/排序后串位）
  let slots: RedisSlotConfig[];
  if (body.redisSlots !== undefined) {
    slots = body.redisSlots.map((s) => ({
      id: s.id,
      label: s.label ?? "",
      url: s.url.trim() || (s.id ? current.redisSlots.find((p) => p.id === s.id)?.url ?? "" : ""),
    }));
  } else if (body.redisUrl !== undefined) {
    const first = current.redisSlots[0];
    slots = [{ id: first?.id, label: first?.label ?? "", url: body.redisUrl || first?.url || "" }];
  } else {
    // 只改开关 / 模式：地址列表保持原样
    slots = current.redisSlots;
  }

  const invalid = slots.find((s) => s.url && !/^rediss?:\/\//.test(s.url));
  if (invalid) {
    throw new AppError(`地址格式不对（需以 redis:// 或 rediss:// 开头）：${maskUrl(invalid.url)}`, 400);
  }
  const filled = slots.filter((s) => s.url.trim());
  const envUrls = (process.env.REDIS_URL ?? "").split(/[,\s]+/).filter(Boolean);
  if (body.redisEnabled && filled.length === 0 && envUrls.length === 0) {
    throw new AppError("启用 Redis 前请至少填写一个地址（或配置环境变量 REDIS_URL）", 400);
  }

  const mode = body.redisMode ?? current.redisMode;
  await saveSettings({ redisEnabled: body.redisEnabled, redisMode: mode, redisSlots: filled });
  // 保存后清冷却并立即重连，保证状态即刻可见
  resetRedisCooldown();
  await getRedis();

  const modeText = mode === "balance" ? "同时读写" : "主备切换";
  await logActivity(
    viewer.id,
    "redis",
    `${body.redisEnabled ? "启用" : "停用"}了 Redis 缓存（${filled.length} 个地址，${modeText}）`
  );
  return ok({ saved: true, hasRedisUrl: filled.length > 0, count: filled.length });
});
