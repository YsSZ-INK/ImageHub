import { handle, assertSameOrigin, ok, AppError } from "@/lib/api";
import { requireApiUser } from "@/lib/session";
import { uploadImages, assertAlbumAccess } from "@/server/image.service";
import { rateLimit } from "@/lib/rate-limit";
import { lookup } from "dns/promises";
import net from "net";

export const runtime = "nodejs";
export const maxDuration = 60;

// 安全员（渗透测试修复）：数值化判断 IP 是否私网/保留段。
// 覆盖 IPv4 私网与保留段、IPv6 本机/链路本地/ULA、IPv4-mapped IPv6（::ffff:127.0.0.1 这类曾绕过旧正则）。
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || // 0.0.0.0/8, 10/8, 127/8
      (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
      (a === 169 && b === 254) || // 169.254/16 链路本地（含云元数据 169.254.169.254）
      (a === 172 && b >= 16 && b <= 31) || // 172.16/12
      (a === 192 && b === 168) || // 192.168/16
      a >= 224 // 组播与保留段
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4-mapped：WHATWG URL 会把 [::ffff:127.0.0.1] 规范化为 ::ffff:7f00:1（十六进制），两种形式都要认
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mappedDotted) return isPrivateIp(mappedDotted[1]);
  const mappedHex = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (/^f[cd]/.test(v6) || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return true; // ULA fc00::/7 与链路本地 fe80::/10
  return false;
}

// 安全员（渗透测试修复）：URL 主机校验——字面量 IP 直接判断；域名先 DNS 解析再判断（防 DNS rebinding）。
async function assertPublicHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    throw new AppError("不允许抓取内网地址", 400);
  }
  if (net.isIPv4(h) || h.includes(":")) {
    if (isPrivateIp(h)) throw new AppError("不允许抓取内网地址", 400);
    return;
  }
  try {
    const { address } = await lookup(h, { family: 0 });
    if (isPrivateIp(address)) throw new AppError("不允许抓取内网地址", 400);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("无法解析目标地址", 400);
  }
}

// URL 远程抓取：服务端拉取 → 同一校验/处理流水线（SSRF 基础防护）
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();

  const rl = await rateLimit(`remote:${user.id}`, 10, 60_000);
  if (!rl.success) throw new AppError("抓取过于频繁", 429);

  const { url, albumId } = (await req.json()) as { url?: string; albumId?: string };
  if (!url || !/^https?:\/\//i.test(url)) throw new AppError("URL 不合法", 400);
  await assertAlbumAccess(user, albumId ?? null);

  // 安全员（渗透测试修复）：redirect: "manual" 逐跳校验（默认跟随重定向会绕过内网检查）
  let res: Response | null = null;
  let finalUrl: URL | null = null;
  try {
    let hop: URL = new URL(url);
    for (let i = 0; i < 3; i++) {
      await assertPublicHost(hop.hostname);
      const r = await fetch(hop, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "ImageHubBot/1.0" },
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        try {
          await r.body?.cancel();
        } catch {}
        if (!loc) break;
        hop = new URL(loc, hop);
        continue;
      }
      res = r;
      finalUrl = hop;
      break;
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("抓取失败：无法访问目标地址", 502);
  }
  if (!res) throw new AppError("抓取失败：重定向次数过多", 502);
  if (!res.ok) throw new AppError(`抓取失败：目标返回 ${res.status}`, 502);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/"))
    throw new AppError("目标不是图片或视频", 415);

  const arr = await res.arrayBuffer();
  if (arr.byteLength > 50 * 1024 * 1024) throw new AppError("远程文件过大（上限 50MB）", 413);

  const name = decodeURIComponent((finalUrl ?? new URL(url)).pathname.split("/").pop() || "remote-file");
  const { results } = await uploadImages(user, [{ buf: Buffer.from(arr), name, contentType }], { albumId: albumId ?? null });
  const first = results[0];
  if (!first || "error" in first) throw new AppError("error" in first ? first.error : "抓取失败", 400);
  return ok(first, 201);
});
