import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { logActivity } from "@/server/audit.service";
import { notifyUserById } from "@/lib/mailer";
import type { Viewer } from "@/server/image.service";

/**
 * 图片访问授权（申请-审批流）：
 * - 用户 A 在用户目录里向 B 发起申请，B 同意后 A 可浏览 B 的全部已发布图片（含 PRIVATE）
 * - 同一申请人对同一主人只有一条记录；拒绝后可再次申请（复用该行重置为 PENDING）
 * - 授权关系是持久业务数据，存 PostgreSQL（不用 Redis——缓存重启即失，不适合授权）
 */

// 判断 viewer 是否已获 targetUserId 授予的浏览权（image.service 可见性判定与列表放宽共用）
export async function hasAccessTo(viewerId: string, targetUserId: string): Promise<boolean> {
  const g = await prisma.imageAccessRequest.findFirst({
    where: { requesterId: viewerId, ownerId: targetUserId, status: "APPROVED" },
    select: { id: true },
  });
  return !!g;
}

export type UserDirectoryEntry = {
  id: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  // 我发给该用户的申请记录 id（pendingFromMe 时用于在卡片上取消申请）
  requestId: string | null;
  // 与当前登录用户的关系：none 无 | pendingFromMe 我已申请待批 | pendingToMe 对方向我申请（去个人中心审批）
  // canViewThem 对方已授权我（可浏览） | grantedToMe 我已授权对方
  relation: "none" | "pendingFromMe" | "pendingToMe" | "canViewThem" | "grantedToMe";
};

// 用户目录：全部 ACTIVE 用户（排除自己），标注与我的授权关系
export async function listUserDirectory(viewer: Viewer): Promise<UserDirectoryEntry[]> {
  const users = await prisma.user.findMany({
    where: { id: { not: viewer.id }, status: "ACTIVE" },
    select: { id: true, name: true, avatarUrl: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const rels = await prisma.imageAccessRequest.findMany({
    where: { OR: [{ requesterId: viewer.id }, { ownerId: viewer.id }] },
    select: { id: true, requesterId: true, ownerId: true, status: true },
  });
  const key = (a: string, b: string) => `${a}>${b}`;
  const relMap = new Map(rels.map((r) => [key(r.requesterId, r.ownerId), r]));
  return users.map((u) => {
    const mine = relMap.get(key(viewer.id, u.id)); // 我申请看 ta
    const theirs = relMap.get(key(u.id, viewer.id)); // ta 申请看我
    let relation: UserDirectoryEntry["relation"] = "none";
    if (mine?.status === "APPROVED") relation = "canViewThem";
    else if (mine?.status === "PENDING") relation = "pendingFromMe";
    else if (theirs?.status === "PENDING") relation = "pendingToMe";
    else if (theirs?.status === "APPROVED") relation = "grantedToMe";
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt.toISOString(),
      requestId: mine?.id ?? null,
      relation,
    };
  });
}

// 发起申请：向 target 用户申请浏览其图片（拒绝过的可重新申请，已授权/待审批则报错）
export async function requestAccess(viewer: Viewer, targetId: string) {
  if (targetId === viewer.id) throw new AppError("不能申请查看自己的图片", 400);
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, status: true, name: true } });
  if (!target || target.status !== "ACTIVE") throw new AppError("目标用户不存在", 404);
  const rel = await prisma.imageAccessRequest.findUnique({
    where: { requesterId_ownerId: { requesterId: viewer.id, ownerId: targetId } },
  });
  if (rel?.status === "APPROVED") throw new AppError(`你已获准浏览 ${target.name} 的图片`, 400);
  if (rel?.status === "PENDING") throw new AppError("申请已提交，等待对方审批", 400);
  if (rel) {
    // 曾被拒绝：重置为待审批
    const updated = await prisma.imageAccessRequest.update({
      where: { id: rel.id },
      data: { status: "PENDING", respondedAt: null },
    });
    void notifyAccessRequested(viewer.id, targetId);
    return { status: updated.status };
  }
  await prisma.imageAccessRequest.create({ data: { requesterId: viewer.id, ownerId: targetId } });
  await logActivity(viewer.id, "access", `向 ${target.name} 申请查看图片`);
  void notifyAccessRequested(viewer.id, targetId);
  return { status: "PENDING" };
}

// 申请邮件：通知被申请人到「交换图片 → 图片访问」审批（失败不影响主流程）
async function notifyAccessRequested(requesterId: string, ownerId: string) {
  try {
    const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { name: true } });
    await notifyUserById(
      ownerId,
      "【ImageHub】新的图片查看申请",
      `${requester?.name ?? "有用户"} 申请查看你的图片。\n请到「交换图片 → 图片访问」页签审批。`
    );
  } catch (e) {
    console.error("[mail] 查看申请通知失败:", e);
  }
}

export type AccessRequestDTO = {
  id: string;
  status: string;
  createdAt: string;
  respondedAt: string | null;
  user: { id: string; name: string; avatarUrl: string | null };
};

// 个人中心「图片访问」面板数据：收到的申请 / 我发出的申请 / 双向已授权名单
export async function listMyAccess(viewer: Viewer) {
  const includeUser = { requester: { select: { id: true, name: true, avatarUrl: true } }, owner: { select: { id: true, name: true, avatarUrl: true } } };
  const [received, sent] = await Promise.all([
    prisma.imageAccessRequest.findMany({ where: { ownerId: viewer.id }, include: includeUser, orderBy: { createdAt: "desc" } }),
    prisma.imageAccessRequest.findMany({ where: { requesterId: viewer.id }, include: includeUser, orderBy: { createdAt: "desc" } }),
  ]);
  const fmt = (r: (typeof received)[number], dir: "received" | "sent"): AccessRequestDTO => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
    user: dir === "received"
      ? { id: r.requester.id, name: r.requester.name, avatarUrl: r.requester.avatarUrl }
      : { id: r.owner.id, name: r.owner.name, avatarUrl: r.owner.avatarUrl },
  });
  return {
    received: received.map((r) => fmt(r, "received")),
    sent: sent.map((r) => fmt(r, "sent")),
  };
}

// 审批：owner 同意 / 拒绝收到的申请；revoke 为 owner 撤销已授权（记录删除，回到无关系）
// cancel 为申请人撤回自己待审批的申请（记录删除，可重新发起）
export async function respondAccess(viewer: Viewer, requestId: string, action: "approve" | "reject" | "revoke" | "cancel") {
  const req = await prisma.imageAccessRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError("申请不存在", 404);
  if (action === "cancel") {
    if (req.requesterId !== viewer.id) throw new AppError("无权处理该申请", 403);
    if (req.status !== "PENDING") throw new AppError("该申请已处理，无法取消", 400);
    const owner = await prisma.user.findUnique({ where: { id: req.ownerId }, select: { name: true } });
    await prisma.imageAccessRequest.delete({ where: { id: requestId } });
    await logActivity(viewer.id, "access", `取消了向 ${owner?.name ?? "对方"} 发起的查看申请`);
    return { status: "CANCELLED" };
  }
  if (req.ownerId !== viewer.id) throw new AppError("无权处理该申请", 403);
  const other = await prisma.user.findUnique({ where: { id: req.requesterId }, select: { name: true } });
  const who = other?.name ?? "对方";
  if (action === "revoke") {
    if (req.status !== "APPROVED") throw new AppError("仅已授权的记录可撤销", 400);
    await prisma.imageAccessRequest.delete({ where: { id: requestId } });
    await logActivity(viewer.id, "access", `撤销了 ${who} 的浏览权限`);
    return { status: "REVOKED" };
  }
  if (req.status !== "PENDING") throw new AppError("该申请已处理", 400);
  const updated = await prisma.imageAccessRequest.update({
    where: { id: requestId },
    data: { status: action === "approve" ? "APPROVED" : "REJECTED", respondedAt: new Date() },
  });
  await logActivity(viewer.id, "access", action === "approve" ? `同意了 ${who} 的查看申请` : `拒绝了 ${who} 的查看申请`);
  return { status: updated.status };
}
