-- 图片表性能索引（页面加载提速）：
-- 1) (visibility, status, deletedAt, createdAt)：公共画廊热点查询
--    （visibility/status/deletedAt 全等 + createdAt 排序）可完全走索引，免 filesort；
-- 2) (storage)：ConsoleShell 每次导航按 storage 聚合本地/各 R2 槽位用量，
--    以及「我的图片」按存储位置筛选（原为全表扫描）。
CREATE INDEX "Image_visibility_status_deletedAt_createdAt_idx" ON "Image"("visibility", "status", "deletedAt", "createdAt");

CREATE INDEX "Image_storage_idx" ON "Image"("storage");
