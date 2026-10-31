import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
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
    select: { requesterId: true, ownerId: true, status: true },
  });
  const key = (a: string, b: string) => `${a}>${b}`;
  const relMap = new Map(rels.map((r) => [key(r.requesterId, r.ownerId), r.status]));
  return users.map((u) => {
    const mine = relMap.get(key(viewer.id, u.id)); // 我申请看 ta
    const theirs = relMap.get(key(u.id, viewer.id)); // ta 申请看我
    let relation: UserDirectoryEntry["relation"] = "none";
    if (mine === "APPROVED") relation = "canViewThem";
    else if (mine === "PENDING") relation = "pendingFromMe";
    else if (theirs === "PENDING") relation = "pendingToMe";
    else if (theirs === "APPROVED") relation = "grantedToMe";
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt.toISOString(),
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
    return { status: updated.status };
  }
  await prisma.imageAccessRequest.create({ data: { requesterId: viewer.id, ownerId: targetId } });
  return { status: "PENDING" };
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
export async function respondAccess(viewer: Viewer, requestId: string, action: "approve" | "reject" | "revoke") {
  const req = await prisma.imageAccessRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError("申请不存在", 404);
  if (req.ownerId !== viewer.id) throw new AppError("无权处理该申请", 403);
  if (action === "revoke") {
    if (req.status !== "APPROVED") throw new AppError("仅已授权的记录可撤销", 400);
    await prisma.imageAccessRequest.delete({ where: { id: requestId } });
    return { status: "REVOKED" };
  }
  if (req.status !== "PENDING") throw new AppError("该申请已处理", 400);
  const updated = await prisma.imageAccessRequest.update({
    where: { id: requestId },
    data: { status: action === "approve" ? "APPROVED" : "REJECTED", respondedAt: new Date() },
  });
  return { status: updated.status };
}
