-- 图片文件存放位置：local 本地磁盘 / r2 Cloudflare R2
-- 存量图片默认 local（保持原状）；按图片记录分别读写，切换存储驱动不影响旧文件
ALTER TABLE "Image" ADD COLUMN "storage" TEXT NOT NULL DEFAULT 'local';
