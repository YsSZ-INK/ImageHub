# ImageHub —— 自托管私有图床 + 画廊

基于 Next.js 15 (App Router) + TypeScript + Prisma + Auth.js v5 + sharp 构建的单实例自托管图床，全站水墨风格界面。

![Build](https://github.com/YsSZ-INK/ImageHub/actions/workflows/docker.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)

## 目录

- [安全模型](#安全模型)
- [功能总览](#功能总览)
- [快速部署（Docker）](#快速部署docker)
- [反向代理与 HTTPS](#反向代理与-https)
- [数据持久化与备份](#数据持久化与备份)
- [本地开发](#本地开发)
- [环境变量](#环境变量)
- [双 Schema 说明](#双-schema-说明)
- [CI/CD](#cicd)
- [故障排查](#故障排查)

## 安全模型

首页即登录页，全站内容（画廊 / 用户主页 / 相册 / 图片详情）仅登录用户可访问。图片二进制通过 `/api/images/[id]/raw|thumb|download` 获取：

- `PUBLIC` / `UNLISTED` 图片的 raw/thumb 直链对未登录放开，可作外链（PRIVATE 仍仅本人与管理员）
- `PRIVATE` 与 download 接口不生成匿名直链 / 签名 URL
- 上传经限流 + MIME + 魔数双校验，EXIF 自动剥离

## 功能总览

**用户**

- 注册（密码强度校验 + bcrypt）、登录 / 登出、记住我、邮箱验证、找回密码
- 个人中心（昵称 / 头像 / 密码 / 配额）、账号注销（级联清理存储）
- 第一个注册的账号自动成为管理员

**图片**

- 拖拽 / 点击 / 粘贴 / URL 抓取上传，多文件并发 + 进度 + 重试
- sha256 秒传去重，自动生成 400px WebP 缩略图与 blurhash 占位
- 可选全量 jpg/png → WebP 转码（`CONVERT_TO_WEBP`）
- 批量操作：删除 / 移动相册 / 打标签 / 改可见性
- 回收站（30 天自动清理）、相册、标签、搜索排序

**可见性模型**

| 级别 | 谁可见 |
| --- | --- |
| `PUBLIC` | 所有登录用户（进画廊） |
| `UNLISTED` | 所有登录用户（有链可访问，不进画廊） |
| `PRIVATE` | 仅本人 |

**画廊**：瀑布流 / 方格切换、分页、标签筛选、灯箱（键盘 ← → ESC / I）、用户主页、相册页

**后台**（仅 ADMIN）：用户管理（封禁 / 角色 / 配额）、图片审核（下架 / 删除）、统计面板（近 7 天趋势）、站点设置（如关闭开放注册）

**其他**：内存 / Redis 限流、深色模式、骨架屏、Toast、空状态、宣纸质感水墨 UI

## 快速部署（Docker）

只需 `postgres` + `web` 两个容器，web 镜像由 GitHub Actions 自动构建并发布到 GHCR，**无需在服务器上构建**。

```bash
# 1. 拉取代码
git clone https://github.com/YsSZ-INK/ImageHub.git && cd ImageHub

# 2. 配置环境变量（必须修改 SITE_URL 与 AUTH_SECRET）
cp .env.example .env
openssl rand -base64 32    # 生成密钥填入 .env 的 AUTH_SECRET

# 3. 启动（首次启动自动执行数据库迁移）
docker compose pull web
docker compose up -d

# 4. 验证
curl http://localhost:3000/api/health   # {"ok":true,"db":"up"}
```

打开 `http://服务器IP:3000`，**注册的第一个账号自动成为管理员**，随后进入 `/admin` 建议关闭开放注册。

### 升级版本

```bash
git pull && docker compose pull web && docker compose up -d
```

### 可选：启用 Redis

限流默认使用进程内存实现，单实例足够；多实例或需要重启后限流计数不丢失时可启用：

```bash
docker compose --profile redis up -d
```

并在 `.env` 中设置 `REDIS_URL=redis://redis:6379`。

## 反向代理与 HTTPS

`SITE_URL` 需配置为对外地址（含协议），例如 `https://img.example.com`。使用 Caddy 示例：

```caddyfile
img.example.com {
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 25MB
    }
}
```

Nginx 需注意调整 `client_max_body_size`（大于上传上限）。

## 数据持久化与备份

| 卷 | 内容 |
| --- | --- |
| `imagehub_postgres_data` | 数据库（用户 / 图片元数据 / 相册标签等） |
| `imagehub_storage_data` | 图片原始文件与缩略图 |

备份：

```bash
docker compose exec -T postgres pg_dump -U imagehub imagehub > backup.sql
docker run --rm -v imagehub_storage_data:/data -v $PWD:/backup alpine tar czf /backup/storage.tgz -C /data .
```

恢复：先 `docker compose down`，还原两个卷后 `docker compose up -d`。

### 常用命令

```bash
docker compose ps                 # 查看状态（web 应为 healthy）
docker compose logs -f web        # 实时日志
docker compose down               # 停止（保留数据）
docker compose down -v            # 停止并清空全部数据（慎用，会删除图片文件）
```

## 本地开发（无需 Docker）

```bash
npm install          # 自动生成 Prisma 客户端（SQLite schema）
npm run db:push      # 建表（SQLite）
npm run dev          # http://localhost:3000
```

- 数据库：SQLite（`prisma/schema.dev.prisma`，文件 `prisma/dev.db`）
- 存储：本地磁盘 `./storage`
- 验证 / 重置邮件：打印到 dev server 控制台

## 环境变量

见 [.env.example](.env.example)（含注释）。关键字段：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 站点对外地址（生成站内链接），如 `https://img.example.com` |
| `AUTH_SECRET` | ✅ | 会话加密密钥，`openssl rand -base64 32` 生成，≥32 字符 |
| `DATABASE_URL` | ✅ | 本地开发 `file:./dev.db`；Docker 部署由 compose 注入 PostgreSQL |
| `LOCAL_STORAGE_DIR` | - | 本地存储目录，容器内为 `/app/storage`，默认 `./storage` |
| `MAX_UPLOAD_MB` | - | 单文件大小上限（MB），默认 20 |
| `CONVERT_TO_WEBP` | - | 是否自动将 jpg/png 转 WebP，默认 false |
| `REDIS_URL` | - | 可选，配置后限流走 Redis，否则降级为进程内存实现 |
| `SMTP_URL` / `RESEND_API_KEY` | - | 可选，接入邮件服务后验证 / 重置邮件改为真实发送 |

## 双 Schema 说明

- `prisma/schema.prisma` —— PostgreSQL（Docker / 生产），迁移文件基于它生成
- `prisma/schema.dev.prisma` —— SQLite（本地开发），模型与生产完全一致
- 为兼容两者，状态字段（role / status / visibility）使用 String + 应用层校验，而非数据库枚举

## CI/CD

推送到 `main` 或 `final-review` 分支后，GitHub Actions 自动执行 Docker 多阶段构建（deps → build → runner），镜像发布为：

```
ghcr.io/yssz-ink/imagehub:latest
ghcr.io/yssz-ink/imagehub:sha-<commit>
```

服务器上 `docker compose pull web && docker compose up -d` 即完成升级。

## 故障排查

**`docker compose build` 卡住不动**
构建需要从 Docker Hub 拉取基础镜像，国内服务器通常无法直连。本项目镜像已由 CI 发布到 GHCR，直接 `docker compose pull web` 即可，无需本地构建。

**上传图片报错（如 `EACCES: permission denied`）**
容器以非 root 用户运行，存储卷属主异常时执行：

```bash
docker compose exec -u root web sh -c "mkdir -p /app/storage && chown nextjs:nodejs /app/storage"
```

**启动报 `P3019`（migration_lock provider 不匹配）**
`prisma/migrations/migration_lock.toml` 必须为 `provider = "postgresql"` 格式，且与 schema 的 datasource 一致。

**启动报 `P3009`（存在失败的迁移记录）**
数据库中有失败迁移。全新部署（无数据）最简单的办法是重建数据库卷：

```bash
docker compose down
docker volume rm imagehub_postgres_data   # 用 docker volume ls 确认实际名称
docker compose up -d
```

已有数据时请按 [Prisma 官方指引](https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate) 用 `prisma migrate resolve` 处理。

**上传失败提示超限**
检查反代的请求体大小限制（Nginx `client_max_body_size` / Caddy `request_body.max_size`）大于 `MAX_UPLOAD_MB`。

## License

[MIT](LICENSE)
