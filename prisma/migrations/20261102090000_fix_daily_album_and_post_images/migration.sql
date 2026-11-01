-- 图文动态与「日常记录」虚拟相册修复：
-- 1) 旧版本发布动态时只把图片设为公开、未同步审核状态（status 仍为 PENDING），
--    新版动态流要求 status=PUBLISHED，导致更新后旧图文动态整体从时间线消失；
--    发布动态本身免审核，这里把动态关联的图片统一补为已发布。
UPDATE "Image" SET "status" = 'PUBLISHED' WHERE "postId" IS NOT NULL AND "status" <> 'PUBLISHED';

-- 2) 旧版本发布动态会自动创建名为「日常记录」的真实相册（每个发布者一个），
--    与新版 /albums/daily 虚拟相册重复展示（相册页出现两个「日常记录」）；
--    删除这些遗留相册。相册删除不删图片：images.albumId 由外键 ON DELETE SET NULL
--    置空，postId 保留，照片仍会汇入新的虚拟相册。
DELETE FROM "Album" WHERE "name" = '日常记录';
