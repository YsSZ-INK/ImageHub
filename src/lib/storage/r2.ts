import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Storage, PutOptions } from "./index";

/**
 * Cloudflare R2 存储驱动（S3 兼容 API）
 * 图片/视频对象经受保护路由（raw/thumb/download）按需取回，桶无需公开访问
 */
export class R2Storage implements Storage {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    this.bucket = cfg.bucket;
  }

  async put(key: string, data: Buffer, opts: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: opts.contentType })
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    // S3 删除不存在的对象同样返回成功，天然幂等
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (name === "NotFound" || name === "NoSuchKey" || name === "404") return false;
      throw err;
    }
  }
}

// 连接测试：写入并删除一个探测对象（R2 API 令牌通常具备对象读写权限，ListObjects 不一定放行）
export async function testR2Connection(cfg: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}): Promise<void> {
  const r2 = new R2Storage(cfg);
  const key = `__imagehub_conn_test_${Date.now()}__`;
  await r2.put(key, Buffer.from("ok"), { contentType: "text/plain" });
  await r2.delete(key);
}

// 桶实时用量：S3 兼容 API 无直接容量查询，只能 ListObjectsV2 逐页累加对象大小
export async function getR2Usage(cfg: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}): Promise<{ bytes: number; objects: number }> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  let bytes = 0;
  let objects = 0;
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, ContinuationToken: token }));
    for (const o of res.Contents ?? []) {
      bytes += o.Size ?? 0;
      objects += 1;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { bytes, objects };
}
