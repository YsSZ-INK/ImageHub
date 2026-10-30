-- 图片审核状态：PUBLISHED 已发布 / PENDING 待审核
-- 存量图片默认视为已发布（保持原有可见性不变）
ALTER TABLE "Image" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED';
CREATE INDEX "Image_status_idx" ON "Image"("status");
