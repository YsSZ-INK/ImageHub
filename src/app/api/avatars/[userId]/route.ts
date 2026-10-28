import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { getAvatar } from "@/server/user.service";

export const runtime = "nodejs";

// 头像访问（仅登录用户）
export const GET = handle(
  async (_req: Request, { params }: { params: Promise<{ userId: string }> }) => {
    const viewer = await getCurrentUser();
    if (!viewer) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    const { userId } = await params;
    const avatar = await getAvatar(userId);
    if (!avatar) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(avatar.buf), {
      headers: {
        "Content-Type": avatar.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }
);
