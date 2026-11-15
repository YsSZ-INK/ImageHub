# ImageHub —— 自托管私有图床 + 画廊

基于 Next.js 15 + React 19 + TypeScript + Prisma 6 + Auth.js v5 + Tailwind CSS 4 的单实例自托管图床，图片与视频共用一套上传、权限与浏览链路。元数据与文件都在你自己的机器上：默认水墨界面，可一键切换云蓝皮肤。

![Build](https://github.com/YsSZ-INK/ImageHub/actions/workflows/docker.yml/badge.svg)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

## 特性

**媒体与上传**

- 图片（jpg / png / webp / gif / avif）与视频（mp4 / webm / mov / mkv）统一管理；视频不设单文件大小上限
- 拖拽 / 粘贴 / URL 抓取三种入口，多文件并发与进度；超过 16MB 自动分片、断点续传；sha256 秒传去重
- 魔数校验与 EXIF 剥离；可选自动转 WebP；缩略图四档（400 / 800 / 1600 / 2560）按浏览器能力自动协商 AVIF / WebP
- 视频以首帧作封面（媒体片段强制定位，移动端不再黑块），灯箱内直接播放，拖进度走 Range 206

**浏览与整理**

- 瀑布流画廊与等比方格；灯箱查看原图 / 原视频，`←` `→` 翻页、`Esc` 关闭，手机返回键先关灯箱而不是离开页面
- 自己的图片可在灯箱内逆时针 / 顺时针旋转 90°（jpg / png / webp），服务端原位重写并即时失效缓存
- 相册分组与封面（默认取相册内第一张）；「我的图片」按存储位置、画廊状态、相册归属组合筛选，全选与批量操作只在当前筛选范围内生效
- 图文动态与「日常记录」：动态照片汇总给管理员查看，不混入「我的图片」、相册与画廊

**存储**

- 本地磁盘 + 任意数量 S3 兼容桶（R2 / OSS / COS / MinIO），每张图记录真实所在位置，读取按记录走
- 后台「存储迁移」页在任意两个位置之间搬图：可逐张勾选，也可整库迁移；视频带首帧封面、点开即可查看/播放；实时进度与失败明细，中断后重跑幂等续迁
- 双向存储对账：缺文件的记录可清理，桶内孤儿可收录进站点或删除；对账完成后自动预热缩略图
- 各存储桶读路径延迟探测，设置页直接显示往返毫秒，方便挑更快的桶
- Redis 可选：支持多个地址，一键切换「主备切换 / 同时读写」；同时读写按 key 哈希分担，同一 key 固定落同一台；未启用时自动降级进程内存
- 公开图片可直连对象存储的公开域名 / CDN，减少回源

**权限与安全**

- 超级管理员 / 管理员 / 普通用户三级；第一个注册的账号自动成为超级管理员
- 公开 / 友链 / 私有三级可见性；所有直链都经后端鉴权，防 IDOR
- 全站登录、登录限流、SSRF 与路径穿越防护、会话吊销；会话为浏览器会话 Cookie，关闭浏览器即需重新登录
- 首注册门控 `SETUP_TOKEN`，避免公网部署被抢注超管

**界面与运维**

- 水墨（默认）与云蓝两套皮肤，顶栏调色板即时切换，偏好保存在本机浏览器
- 站点设置（邮件、Redis、存储桶、上传上限等）保存即生效；上传、批量删除、设封面等交互走 AJAX 局部刷新
- 后台一键整包备份还原；`manage.sh` 提供 19 项日常运维菜单

## 快速开始

镜像由 GitHub Actions 构建并发布到 GHCR，服务器上无需本地构建。

**一键安装**（自动装 Docker、拉镜像、启动，随后引导注册站长账号）：

```bash
curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/install.sh | bash
```

安装过程会逐项询问：安装目录、端口、绑定地址、站点地址、登录回调地址（AUTH_URL）、数据库密码、图片上传上限、是否转 WebP、是否启用 Redis——**每一步直接回车即用默认值**，最后确认配置再开始。没有终端（CI）时自动全取默认值，也可用环境变量预设（见脚本头部注释）。

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
| `REDIS_URL` | 可选，限流与公开直链缓存落 Redis（站点设置里的地址优先；支持逗号分隔多个地址做主备） |
| `TRUST_PROXY` | 反代后设为 `1`，按真实客户端 IP 限流 |

## 存储与迁移

新上传只写入当前默认存储位置，已有文件永远按记录里的位置读取，所以改默认桶不会让老图片失效。

在后台「存储迁移」页可以把文件整体搬到另一个位置（包括本地 ⇄ 各存储桶、桶 ⇄ 桶）：

1. 选择「从」与「到」；只有一个可用位置时页面会提示先配置存储桶
2. 逐张勾选要迁移的文件，或直接勾选「迁移该位置全部」；视频卡片显示首帧封面，点封面即可播放/查看
3. 发起后后台执行「读源 → 写目标 → 更新记录 → 删源」，页面实时显示进度与失败明细
4. 任何一步失败的文件都留在原位置，重跑即可续迁，不会重复处理已完成的条目

迁移进行中存储对账会自动暂停，避免「记录指向尚未复制完的对象」的中间态被误判。

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
- **数据卷**：`imagehub_postgres_data`（数据库）、`imagehub_storage_data`（图片与视频文件）

## 目录结构

```
imagehub/
├── prisma/            # PostgreSQL / SQLite 两套 schema 与迁移
├── src/
│   ├── app/           # 页面与 API 路由（App Router）
│   ├── components/    # UI 组件（画廊、灯箱、上传、迁移、设置）
│   ├── server/        # 业务逻辑（图片 / 动态 / 迁移 / 对账 / 分片）
│   ├── lib/           # 会话、校验、存储驱动、缓存、限流、皮肤
│   └── middleware.ts  # 访问控制
├── install.sh         # 一键安装脚本
├── manage.sh          # 站点管理脚本
├── Dockerfile
└── docker-compose.yml
```

## 许可

本项目基于 [GPL-3.0](LICENSE) 协议开源。
