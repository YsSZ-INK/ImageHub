-- 图片原位重写（旋转 90°）后的版本号：自增作为原图/缩略图 URL 的缓存破绽参数，
-- 让浏览器跳过 immutable 缓存立即加载新图；存量记录从 0 开始，行为与之前一致
ALTER TABLE "Image" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
