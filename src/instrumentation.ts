// Next.js 运行时钩子：服务器启动后开启 R2 双向同步定时对账。
// import 必须放在 NEXT_RUNTIME 分支内：构建时按目标运行时裁剪，
// 避免 node-only 依赖链（fs 等）被打进 edge 包导致构建失败。

// 生产环境启动前强校验 AUTH_SECRET：公开缺省值等于人人可伪造会话 JWT，
// 拒绝缺失、已知默认值与长度不足的密钥（开发环境放行便于本地调试）。
const KNOWN_DEFAULT_SECRETS = [
  "please-change-me-32chars-minimum",
  "dev-secret-change-me-0123456789abcdef",
];

function assertAuthSecret() {
  if (process.env.NODE_ENV !== "production") return;
  const s = process.env.AUTH_SECRET ?? "";
  if (KNOWN_DEFAULT_SECRETS.includes(s) || s.length < 32) {
    throw new Error(
      "AUTH_SECRET 未正确配置：请执行 openssl rand -base64 32 生成并写入 .env" +
        "（长度至少 32 字符，不得使用公开默认值）。" +
        "注意：更换 AUTH_SECRET 后，站点设置里已保存的 R2/SMTP 密钥将无法解密，需重新填写保存。"
    );
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertAuthSecret();
    await import("@/server/r2-sync.service").then((m) => m.startR2SyncLoop());
  }
}
