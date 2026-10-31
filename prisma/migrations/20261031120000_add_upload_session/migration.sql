-- 分片上传会话：大文件（>16MB）切片上传的会话元数据；分片数据在本地磁盘 .chunks/{id}/ 下
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "albumId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadSession_userId_idx" ON "UploadSession"("userId");
CREATE INDEX "UploadSession_createdAt_idx" ON "UploadSession"("createdAt");

ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
