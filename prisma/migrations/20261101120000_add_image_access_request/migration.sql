-- 图片访问授权（申请-审批流）：A 向 B 申请浏览其图片，B 同意后 A 可浏览 B 的全部已发布图片（含 PRIVATE）
CREATE TABLE "ImageAccessRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ImageAccessRequest_pkey" PRIMARY KEY ("id")
);

-- 同一申请人对同一图片主人只允许一条申请记录（拒绝后可再次申请，复用该行重置状态）
CREATE UNIQUE INDEX "ImageAccessRequest_requesterId_ownerId_key" ON "ImageAccessRequest"("requesterId", "ownerId");
CREATE INDEX "ImageAccessRequest_ownerId_status_idx" ON "ImageAccessRequest"("ownerId", "status");
CREATE INDEX "ImageAccessRequest_requesterId_status_idx" ON "ImageAccessRequest"("requesterId", "status");

ALTER TABLE "ImageAccessRequest" ADD CONSTRAINT "ImageAccessRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageAccessRequest" ADD CONSTRAINT "ImageAccessRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
