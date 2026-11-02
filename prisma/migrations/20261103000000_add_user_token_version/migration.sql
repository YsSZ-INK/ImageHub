-- 会话吊销——用户改密/被管理员重置密码后 tokenVersion +1，
-- 签发于其前的 JWT 会话全部失效（应用层比对，见 src/lib/session.ts）
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
