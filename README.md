# ImageHub —— 自托管私有图床 + 画廊

基于 Next.js 15 (App Router) + TypeScript + Prisma + Auth.js v5 + sharp 构建的单实例自托管图床，全站水墨风格界面。

![Build](https://github.com/YsSZ-INK/ImageHub/actions/workflows/docker.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)

**核心安全模型**：首页即登录页，全站内容（画廊 / 用户主页 / 相册 / 图片详情 / 图片二进制）仅登录用户可访问。所有图片只能通过受保护路由 `/api/images/[id]/raw|thumb|download` 获取，不生成匿名直链 / 签名 URL，复制按钮只产出需登录的站内链接。

## 功能总览

**用户**
- 注册（密码强度校验 + bcrypt）、登录 / 登出、记住我、邮箱验证、找回密码、个人中心（昵称 / 头像 / 密码 / 配额）、账号注销（级联清理存储）
- 第一个注册的账号自动成为管理员

**图片**
- 拖拽 / 点击 / 粘贴 / URL 抓取上传，多文件并发 + 进度 + 重试
- MIME + 魔数双校验、sha256 秒传去重、EXIF 自动剥离
- 自动生成 400px WebP 缩略图与 blurhash 占位，可选全量 WebP 转码
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

**其他**：内存限流、深色模式、骨架屏、Toast、空状态、宣纸质感水墨 UI

## Docker 部署（推荐）

只需 `postgres` + `web` 两个容器，web 镜像由 GitHub Actions 自动构建发布到 GHCR。

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

打开 `http://服务器IP:3000`，注册第一个账号即管理员，随后进入 `/admin` 建议关闭开放注册。

### 更新版本

```bash
git pull && docker compose pull web && docker compose up -d
```

### 数据持久化

| 卷 | 内容 |
| --- | --- |
| `imagehub_postgres_data` | 数据库（用户 / 图片元数据 / 相册标签等） |
| `imagehub_storage_data` | 图片原始文件与缩略图 |

备份示例：

```bash
docker compose exec -T postgres pg_dump -U imagehub imagehub > backup.sql
docker run --rm -v imagehub_storage_data:/data -v $PWD:/backup alpine tar czf /backup/storage.tgz -C /data .
```

### 常用命令

```bash
docker compose ps                 # 查看状态（web 应为 healthy）
docker compose logs -f web        # 实时日志
docker compose down               # 停止（保留数据）
docker compose down -v            # 停止并清空数据（慎用）
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
| `LOCAL_STORAGE_DIR` | - | 本地存储目录，默认 `./storage` |
| `MAX_UPLOAD_MB` | - | 单文件大小上限（MB），默认 20 |
| `CONVERT_TO_WEBP` | - | 是否自动将 jpg/png 转 WebP，默认 false |
| `SMTP_URL` / `RESEND_API_KEY` | - | 可选，接入邮件服务后验证 / 重置邮件改为真实发送 |

## 双 Schema 说明

- `prisma/schema.prisma` —— PostgreSQL（Docker / 生产），迁移文件基于它生成
- `prisma/schema.dev.prisma` —— SQLite（本地开发），模型与生产完全一致
- 为兼容两者，状态字段（role / status / visibility）使用 String + 应用层校验，而非数据库枚举

## CI/CD

推送到 `main` 分支后，GitHub Actions 自动执行 Docker 多阶段构建（deps → build → runner），镜像发布为：

```
ghcr.io/yszz-ink/imagehub:latest
ghcr.io/yszz-ink/imagehub:sha-<commit>
```

服务器上 `docker compose pull web && docker compose up -d` 即完成升级。

## License

[MIT](LICENSE)
