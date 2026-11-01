-- 动态评论：登录用户可评论；删除限本人或管理员
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- 按动态拉取评论（时间序）+ 用户评论列表
CREATE INDEX "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");
CREATE INDEX "PostComment_userId_idx" ON "PostComment"("userId");

-- 动态删除时级联删评论；用户注销时级联删其评论
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
