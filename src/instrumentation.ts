// Next.js 运行时钩子：服务器启动后开启 R2 双向同步定时对账。
// import 必须放在 NEXT_RUNTIME 分支内：构建时按目标运行时裁剪，
// 避免 node-only 依赖链（fs 等）被打进 edge 包导致构建失败。
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/server/r2-sync.service").then((m) => m.startR2SyncLoop());
  }
}
