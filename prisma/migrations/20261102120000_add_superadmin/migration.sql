-- 权限分级：超级管理员 = 第一个注册的账号（站长）
-- 仅将最早注册的管理员升级为超级管理员，其余管理员保持普通管理员；
-- 此后超级管理员可在用户管理中把他人设为/撤销超级管理员
UPDATE "User" SET "role" = 'SUPERADMIN'
WHERE "id" = (
  SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1
);
