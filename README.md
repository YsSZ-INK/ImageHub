# ImageHub —— 自托管私有图床 + 画廊

基于 Next.js 15 + React 19 + TypeScript + Prisma 6 + Auth.js v5 + Tailwind CSS 4 的单实例自托管图床，支持图片与视频。全站宣纸水墨界面，数据与文件都在你自己的机器上。

![Build](https://github.com/YsSZ-INK/ImageHub/actions/workflows/docker.yml/badge.svg)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

## 特性

- **上传与管理**：拖拽 / 粘贴 / URL 抓取，多文件并发与进度；超过 16MB 自动分片、断点续传；sha256 秒传去重；魔数校验与 EXIF 剥离；支持 mp4/webm/mov/mkv 视频
- **浏览**：瀑布流画廊、灯箱原图、相册封面；缩略图三级缓存，大列表滚动流畅
- **图文动态**：朋友圈式发布，照片自动汇总进「日常记录」（仅管理员可见，带上传者与时间标记）；动态照片只出现在动态与日常记录，不进「我的图片」、相册与画廊
- **多桶存储**：本地磁盘 + 任意数量 S3 兼容桶（R2 / OSS / COS / MinIO），每张图记录真实位置，可任意互迁
- **存储对账**：双向核对数据库与桶内对象，缺文件的记录可清理，桶内残留可移入网站或删除
- **权限**：超级管理员（第一个注册的账号）管用户/设置/迁移/备份；管理员只做内容审核；普通用户只管自己的内容
- **安全**：全站登录、直链受保护、登录限流、SSRF 与路径穿越防护、会话吊销、首注册门控（`SETUP_TOKEN`）
- **运维**：后台一键整包备份还原；`manage.sh` 提供 19 项日常运维菜单

## 快速开始

镜像由 GitHub Actions 构建并发布到 GHCR，服务器上无需本地构建。

**一键安装**（自动装 Docker、拉镜像、启动，随后引导注册站长账号）：

```bash
curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/install.sh | bash
```

**Docker Compose**：

```bash
git clone https://github.com/YsSZ-INK/ImageHub.git && cd ImageHub
cp .env.example .env          # 修改 SITE_URL 与 AUTH_SECRET
docker compose pull web
docker compose up -d
curl http://localhost:3000/api/health   # {"ok":true,"db":"up"}
```

默认只监听 `127.0.0.1`，本机打开 `http://localhost:3000`，**第一个注册的账号自动成为超级管理员**。要让外网访问，把 `.env` 的 `BIND_IP` 改为 `0.0.0.0`（建议配防火墙），或用 Nginx/Caddy 反代并加 HTTPS（反代时设 `TRUST_PROXY=1`）。

## 环境变量

见 [.env.example](.env.example)。关键项：

| 变量 | 说明 |
| --- | --- |
| `SITE_URL` | 站点对外地址，用于生成站内链接 |
| `AUTH_SECRET` | 会话密钥，`openssl rand -base64 32` 生成 |
| `POSTGRES_PASSWORD` | 数据库密码（Docker 部署由 compose 拼接连接串） |
| `DATABASE_URL` | 本地开发为 `file:./dev.db`；Docker 由 compose 注入 |
| `SETUP_TOKEN` | 可选首注册门控：空库首次注册必须携带，防公网抢注超管 |
| `BIND_IP` / `PORT` | 监听地址与端口，默认 `127.0.0.1:3000` |
| `MAX_UPLOAD_MB` | 图片单文件上限天花板，实际生效取与界面设置的较小值（视频不设大小上限） |
| `REDIS_URL` | 可选，限流计数落 Redis（站点设置里的地址优先） |
| `TRUST_PROXY` | 反代后设为 `1`，按真实客户端 IP 限流 |

## 本地开发

```bash
npm install
npm run db:push     # SQLite 建表（prisma/dev.db）
npm run dev         # http://localhost:3000
```

`next dev` 按需编译，首次打开某个页面会慢几秒；`npm run build && npm start` 是生产模式。
生产使用 PostgreSQL（`prisma/schema.prisma`），本地使用 SQLite（`prisma/schema.dev.prisma`），两者模型一致。

## 常用运维

```bash
cd ~/ImageHub && bash manage.sh     # 交互菜单
```

覆盖更新、卸载、改端口、重置密码、角色管理、日志、备份/还原、Redis 开关等 19 项，也支持子命令（如 `bash manage.sh update`）。

- **忘记密码**：`bash manage.sh password` 按邮箱重置为 `Admin123456`；配置了 SMTP 也可走「忘记密码」邮件
- **备份**：后台「站点设置 → 备份与还原」整包下载；或 `bash manage.sh backup` / `manage.sh cron` 每日自动备份
- **数据卷**：`imagehub_postgres_data`（数据库）、`imagehub_storage_data`（图片文件）

## 目录结构

```
imagehub/
├── prisma/            # PostgreSQL / SQLite 两套 schema 与迁移
├── src/
│   ├── app/           # 页面与 API 路由（App Router）
│   ├── components/    # UI 组件
│   ├── server/        # 业务逻辑（图片 / 动态 / 迁移 / 对账 / 分片）
│   ├── lib/           # 会话、校验、存储驱动、缓存、限流
│   └── middleware.ts  # 访问控制
├── install.sh         # 一键安装脚本
├── manage.sh          # 站点管理脚本
├── Dockerfile
└── docker-compose.yml
```

## 许可

本项目基于 [GPL-3.0](LICENSE) 协议开源。
