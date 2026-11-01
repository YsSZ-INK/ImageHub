import { prisma } from "@/lib/db";

/**
 * 站点操作日志：
 * - 把关键动作写成普通用户能看懂的中文句子（「谁 + 做了什么」），管理员在「站点设置 → 操作日志」查看
 * - 写日志失败只打印告警，绝不影响主流程
 */
export async function logActivity(actorId: string | null, action: string, verb: string) {
  try {
    let name = "系统";
    if (actorId) {
      const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
      name = u?.name ?? "已注销用户";
    }
    await prisma.activityLog.create({ data: { userId: actorId, action, detail: `${name} ${verb}` } });
  } catch (err) {
    console.error("[audit] 写日志失败:", err);
  }
}

// 日志列表（管理员）：时间倒序，页码分页
export async function listActivityLogs(page = 1, pageSize = 10) {
  const p = Math.max(1, Math.floor(page) || 1);
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, avatarUrl: true } } },
    }),
    prisma.activityLog.count(),
  ]);
  return {
    page: p,
    pageSize,
    total,
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
      user: r.user ? { name: r.user.name, avatarUrl: r.user.avatarUrl } : null,
    })),
  };
}
