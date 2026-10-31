import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import type { Storage, PutOptions } from "./index";
import { slotEndpoint } from "@/lib/markers";

/**
 * S3 兼容对象存储驱动：Cloudflare R2（默认）或任意 S3 兼容端点
 * （阿里云 OSS、腾讯云 COS、MinIO、Wasabi…填 endpoint + region 即可）
 * 图片/视频对象经受保护路由（raw/thumb/download）按需取回，桶无需公开访问
 */
export type S3CompatibleConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  // 自定义 S3 兼容端点（如 https://oss-cn-hangzhou.aliyuncs.com），留空则用 R2 端点
  endpoint?: string;
  // SDK region：OSS 填如 oss-cn-hangzhou；R2 留空自动用 auto
  region?: string;
};

export function makeS3Client(cfg: S3CompatibleConfig): S3Client {
  const endpoint = slotEndpoint(cfg);
  if (!endpoint) throw new Error("存储端点未配置：请补全 Account ID / Region / S3 端点");
  return new S3Client({
    region: cfg.region?.trim() || "auto",
    endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // R2 与多数 S3 兼容实现都要求 path-style 寻址（bucket 在路径中）
    forcePathStyle: true,
    // 回源超时 30s：网络差时快速失败（可重试），避免请求无限挂起拖住缓存 inflight
    requestHandler: { requestTimeout: 30_000, connectionTimeout: 10_000, throwOnRequestTimeout: true },
  });
}

export class R2Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  private cfg: S3CompatibleConfig;

  constructor(cfg: S3CompatibleConfig) {
    this.cfg = cfg;
    this.client = makeS3Client(cfg);
    this.bucket = cfg.bucket;
  }

  async put(key: string, data: Buffer, opts: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: opts.contentType })
    );
  }

  // 流式写入：Readable 直传（ContentLength 必须显式提供，避免 aws-chunked 编码不被部分 S3 兼容服务接受）
  async putStream(key: string, stream: Readable, opts: PutOptions & { size: number }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: opts.contentType,
        ContentLength: opts.size,
      })
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async getSize(key: string): Promise<number> {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.ContentLength ?? 0;
  }

  async getRange(key: string, start: number, endExclusive: number): Promise<{ body: ReadableStream<Uint8Array>; length: number }> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${endExclusive - 1}` })
    );
    if (!res.Body) throw new Error("存储返回空响应");
    return {
      body: res.Body.transformToWebStream() as unknown as ReadableStream<Uint8Array>,
      length: res.ContentLength ?? endExclusive - start,
    };
  }

  // 下载专用客户端：整文件下载耗时长，复用 30s 回源超时会把大文件下载中途打断
  private dlClient: S3Client | null = null;
  private downloadClient(): S3Client {
    if (!this.dlClient) {
      this.dlClient = new S3Client({
        region: this.cfg.region?.trim() || "auto",
        endpoint: slotEndpoint(this.cfg),
        credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey },
        forcePathStyle: true,
        requestHandler: { requestTimeout: 300_000, connectionTimeout: 10_000, throwOnRequestTimeout: true },
      });
    }
    return this.dlClient;
  }

  // 并行分片整文件读取：把文件切成 8MB 段，窗口内 3 路并发请求、按序写出。
  // 单连接被 RTT/丢包限速时（国内访问 R2 尤其明显），多连接并行可提升 2-4 倍；
  // 内存占用恒定 ≤ 窗口 × 段大小（3 × 8MB = 24MB），下载完成即释放。
  async getParallelStream(key: string, total: number): Promise<ReadableStream<Uint8Array>> {
    const SEG = 8 * 1024 * 1024;
    const WINDOW = 3;
    const client = this.downloadClient();
    const pt = new TransformStream<Uint8Array, Uint8Array>();
    const ranges: Array<[number, number]> = [];
    for (let s = 0; s < total; s += SEG) ranges.push([s, Math.min(s + SEG, total)]);
    void (async () => {
      try {
        for (let i = 0; i < ranges.length; i += WINDOW) {
          const batch = ranges.slice(i, i + WINDOW);
          const bodies = await Promise.all(
            batch.map(([s, e]) =>
              client
                .send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${s}-${e - 1}` }))
                .then((r) => {
                  if (!r.Body) throw new Error("存储返回空响应");
                  return r.Body.transformToWebStream() as ReadableStream<Uint8Array>;
                })
            )
          );
          // 窗口内已并行下载，这里按序写入同一条输出流（preventClose 允许多个源接力写入）
          for (const b of bodies) await b.pipeTo(pt.writable, { preventClose: true });
        }
        await pt.writable.close();
      } catch (err) {
        await pt.writable.abort(err).catch(() => {});
      }
    })();
    return pt.readable;
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

// 连接测试：写入并删除一个探测对象（API 令牌通常具备对象读写权限，ListObjects 不一定放行）
export async function testR2Connection(cfg: S3CompatibleConfig): Promise<void> {
  const r2 = new R2Storage(cfg);
  const key = `__imagehub_conn_test_${Date.now()}__`;
  await r2.put(key, Buffer.from("ok"), { contentType: "text/plain" });
  await r2.delete(key);
}

// 桶实时用量：S3 兼容 API 无直接容量查询，只能 ListObjectsV2 逐页累加对象大小
export async function getR2Usage(cfg: S3CompatibleConfig): Promise<{ bytes: number; objects: number }> {
  const client = makeS3Client(cfg);
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
