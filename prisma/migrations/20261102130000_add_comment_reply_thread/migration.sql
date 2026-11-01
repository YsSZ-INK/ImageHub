-- 评论回复线程（补齐遗漏的 PostgreSQL 迁移）：
-- parentId 指向所属顶层评论（一层线程，自引用，顶层删除时回复级联删除）；
-- replyToUserId 记录被回复人（展示「回复 @某人」，用户注销时置空）。
-- 此前该特性只更新了 schema 与 SQLite 开发库，生产 PostgreSQL 缺列导致
-- PrismaClientKnownRequestError P2022（PostComment.parentId does not exist）。
ALTER TABLE "PostComment" ADD COLUMN "parentId" TEXT;
ALTER TABLE "PostComment" ADD COLUMN "replyToUserId" TEXT;

CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId");

ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_replyToUserId_fkey" FOREIGN KEY ("replyToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
