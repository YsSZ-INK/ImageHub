// 角色分级（客户端/服务端/边缘中间件均可使用）：
// - USER：普通用户
// - ADMIN：管理员（内容管理：统计面板、图片审核、删除违规动态/评论）
// - SUPERADMIN：超级管理员（全部权限，含用户管理/站点设置/存储迁移/备份/日志）
// 约定：超级管理员唯一，仅由数据迁移产生，不通过 UI 创建或降级。
export function isAdminRole(role: string | undefined | null): boolean {
  return role === "ADMIN" || role === "SUPERADMIN";
}

export function isSuper(role: string | undefined | null): boolean {
  return role === "SUPERADMIN";
}
