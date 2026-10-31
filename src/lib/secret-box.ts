import crypto from "crypto";

/**
 * 密钥字段落库加密（AES-256-GCM）：
 * - 密钥由 AUTH_SECRET 派生（sha256），无需额外配置
 * - 存储格式 enc:v1:<iv>:<authTag>:<ciphertext>（均 base64）
 * - 解密兼容旧明文值（无前缀直接返回）；解密失败（如更换了 AUTH_SECRET）返回空串，需重新保存
 */

const PREFIX = "enc:v1:";

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(process.env.AUTH_SECRET || "imagehub-dev-secret").digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value; // 旧明文兼容
  try {
    const [, , ivB64, tagB64, dataB64] = value.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return ""; // AUTH_SECRET 变更导致解不开：视为未配置，需重新保存
  }
}
