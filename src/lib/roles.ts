// 角色分级（客户端/服务端/边缘中间件均可使用）：
// - USER：普通用户
// - ADMIN：管理员（内容管理：统计面板、图片审核、删除违规动态/评论）
// - SUPERADMIN：超级管理员（全部权限，含用户管理/站点设置/存储迁移/备份/日志）
// 约定：超级管理员 = 第一个注册的账号（站长）；超级管理员可授予/撤销他人身份，站点至少保留一个。
export function isAdminRole(role: string | undefined | null): boolean {
  return role === "ADMIN" || role === "SUPERADMIN";
}

export function isSuper(role: string | undefined | null): boolean {
  return role === "SUPERADMIN";
}
