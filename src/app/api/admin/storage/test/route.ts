import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { testR2Connection } from "@/lib/storage/r2";
import { getSettings } from "@/lib/settings";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  accountId: z.string().min(1, "缺少 Account ID"),
  accessKeyId: z.string().min(1, "缺少 Access Key ID"),
  // 密钥只写不读：表单中留空时通过 slotIndex 回退到服务端已存的 Secret
  secretAccessKey: z.string().default(""),
  bucket: z.string().min(1, "缺少 Bucket"),
  slotIndex: z.number().int().min(0).max(7).optional(),
});

// R2 连接测试：真实写入并删除一个探测对象，验证端点、密钥与读写权限
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const viewer = await requireApiUser();
  if (viewer.role !== "ADMIN") throw new AppError("无权限", 403);
  const input = schema.parse(await req.json());
  let secret = input.secretAccessKey;
  if (!secret) {
    if (input.slotIndex == null) throw new AppError("缺少 Secret Access Key", 400);
    const s = await getSettings();
    secret = s.r2Slots[input.slotIndex]?.secretAccessKey ?? "";
    if (!secret) throw new AppError("该桶尚未保存 Secret Access Key", 400);
  }
  try {
    await testR2Connection({
      accountId: input.accountId,
      accessKeyId: input.accessKeyId,
      secretAccessKey: secret,
      bucket: input.bucket,
    });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    const name = e.name ?? "";
    const hint =
      name === "SignatureDoesNotMatch" || name === "InvalidAccessKeyId"
        ? "密钥不正确"
        : name === "NoSuchBucket"
          ? "存储桶不存在"
          : name === "AccessDenied"
            ? "令牌权限不足（需要对象读和写）"
            : name === "NetworkingError" || name === "ENOTFOUND"
              ? "无法连接到 R2 端点，请检查 Account ID 与服务器网络"
              : "连接失败";
    throw new AppError(`R2 ${hint}（${name || "Error"}）`, 400);
  }
  return ok({ message: "连接成功：端点、密钥与读写权限均正常" });
});
