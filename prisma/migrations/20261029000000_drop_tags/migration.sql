-- 删除标签功能：ImageTag 先于 Tag 删除（外键依赖）
DROP TABLE IF EXISTS "ImageTag";
DROP TABLE IF EXISTS "Tag";
