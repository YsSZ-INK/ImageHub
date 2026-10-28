import { NextResponse } from "next/server";
import { handle, assertSameOrigin, ok } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { registerUser, publicUser } from "@/server/user.service";
import { getSettings } from "@/lib/settings";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// 注册（受站点设置控制 + IP 限流）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const rl = await rateLimit(`register:${clientIp(req)}`, 10, 60_000);
  if (!rl.success) return NextResponse.json({ ok: false, error: "注册过于频繁，请稍后再试" }, { status: 429 });

  const settings = await getSettings();
  if (!settings.allowRegister) {
    return NextResponse.json({ ok: false, error: "站点已关闭注册" }, { status: 403 });
  }
  const body = await req.json();
  const input = registerSchema.parse(body);
  const user = await registerUser(input);
  return ok({ user: publicUser(user) }, 201);
});
