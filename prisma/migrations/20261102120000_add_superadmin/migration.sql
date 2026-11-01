-- 权限分级：引入唯一超级管理员（站长）
-- 现有 ADMIN 账号全部升级为 SUPERADMIN；此后可在后台把其他账号设为普通管理员（ADMIN）
UPDATE "User" SET "role" = 'SUPERADMIN' WHERE "role" = 'ADMIN';
