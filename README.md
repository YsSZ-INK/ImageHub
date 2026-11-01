# ImageHub —— 自托管私有图床 + 画廊

基于 Next.js 15 (App Router) + React 19 + TypeScript + Prisma 6 + Auth.js v5 + Tailwind CSS 4 构建的单实例自托管图床，支持图片与视频，全站宣纸质感水墨界面，一张水墨背景贯穿公开页与控制台。前端 bundle 构建时经混淆处理（变量名十六进制化 + 字符串抽离打散），抬高点开浏览器控制台逆向阅读的门槛。

![Build](https://github.com/YsSZ-INK/ImageHub/actions/workflows/docker.yml/badge.svg)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

## 目录

- [功能总览](#功能总览)
- [存储与迁移](#存储与迁移)
- [上传与分片](#上传与分片)
- [安全模型](#安全模型)
- [安装 / 更新 / 卸载](#安装--更新--卸载)
- [环境变量](#环境变量)
- [反向代理与 HTTPS](#反向代理与-https)
- [数据持久化与备份](#数据持久化与备份)
- [忘记密码](#忘记密码)
- [本地开发](#本地开发)
- [CI/CD](#cicd)
- [项目结构与页面路由](#项目结构与页面路由)
- [故障排查](#故障排查)

## 功能总览

**上传与管理**

- 拖拽 / 点击选择 / 剪贴板粘贴 / URL 远程抓取，多文件受控并发 + 进度条 + 失败重试
- 超过 16MB 的大文件自动分片上传（见[上传与分片](#上传与分片)）
- sha256 秒传去重；图片自动生成 400px WebP 缩略图与 blurhash 占位；可选全量 jpg/png → WebP 转码（`CONVERT_TO_WEBP`）
- 魔数校验真实文件类型（不信任浏览器 MIME 声明），EXIF 自动剥离（含 GPS）
- 支持视频 mp4 / webm / mov / mkv：无缩略图时用 `<video>` 取首帧，播放/拖动全程流式 Range，不占服务器内存
- 「我的图片」支持按存储位置筛选（本地 / 各存储桶）、批量删除 / 移动相册 / 设置可见性
- 选中图片后信息条五格均分展示：外链 / 存储位置 / 所属画廊状态 / 可见性 / 文件大小；「外链」按钮一键复制直链
- 回收站（软删除保留 30 天自动清理）、搜索排序

**画廊与浏览**

- 公共画廊瀑布流 + 翻页，游标分页带稳定排序（不重不漏）
- 瀑布流卡片 `content-visibility` 优化，大列表滚动丝滑
- 灯箱点击立即加载高清原图（不经过模糊占位），hover / 翻页预取相邻原图；键盘 ← → ESC / I
- 缩略图现场生成 + 三级缓存：内存 LRU（128MB）+ 服务端磁盘持久缓存（对象存储图片的 400px / 2560px 档均落盘），缓存每日清空重建；缩略图只存本地、不上传对象存储桶
- 对象存储整文件下载走多连接并行分片回源（8MB/段 × 3 并发窗口），弱网到远端桶也能跑满带宽
- 公共画廊、图文动态、用户主页（`/u/[username]`）、相册页
- 全分辨率响应式：移动端横向导航、桌面侧栏布局、超大屏 8 列网格

**交换图片（用户间授权浏览）**

- 向站内其他用户发起「查看图片」申请，对方在个人中心同意 / 拒绝（拒绝后可重新申请，已授权可撤销）
- 授权后可浏览对方全部已发布图片（含私密；待审核的仍不可见），未授权只能看到对方的公开图
- 「交换图片」页：已授权用户头像横排切换条，点击在页面内即时切换浏览对象（无需跳转）；服务端预取首位用户首屏
- 用户目录支持用户名搜索（本地即时过滤），待审批申请在页顶提醒直达个人中心

**相册**

- 相册管理页：封面缩略图卡片、创建 / 编辑 / 删除；未手动设置封面时自动取相册内第一张图作为封面
- 相册详情页（拥有者）：批量移出相册 / 设为封面 / 删除，封面被移出或删除时自动清空引用
- 「日常记录」（`/albums/daily`）：无需创建的虚拟相册，仅管理员可见——自动汇总所有图文动态发布的照片，每张带「@上传者」标记，支持按上传者与上传时间范围筛选（可组合）

**图文动态**

- 朋友圈式 feed：文字（可纯文字）+ 最多 9 张图九宫格，图片可从已有图库挑选或现传
- 发动态免审核：随发布立即公开进 feed；照片留在原相册，同时汇总进「日常记录」
- 评论支持回复（一层线程，「回复 @某人」标记），动态页常驻最近 3 条 + 「查看更多评论」
- 删除动态时其中的图片一并移入回收站（可从回收站恢复），纯文字动态仅删除本身

**账号**

- 注册（密码强度校验 + bcrypt）、登录 / 登出、记住我、邮箱验证、找回密码
- 个人中心（昵称 / 头像 / 密码 / 配额）、账号注销（级联清理存储）
- **第一个注册的账号自动成为超级管理员（站长）**；超级管理员可在用户管理中把他人设为 / 撤销超级管理员

**后台（两级权限）**

- **超级管理员**（第一个注册的账号，站长）：看见所有东西——统计面板、图片审核，外加用户管理 / 存储迁移 / 站点设置 / 备份还原 / 操作日志，可见所有人的相册与私有图片；可在用户管理中把他人设为 / 撤销超级管理员（站点至少保留一个）
- **管理员**（内容管理层，由超级管理员在用户管理中设置）：统计面板、图片审核队列（批准 / 下架 / 删除）、删除违规动态与评论、查看「日常记录」；上传免审核；**不能**看他人的私有照片与相册，**不能**进用户管理 / 存储迁移 / 站点设置 / 备份 / 日志

## 存储与迁移

**多类型存储**：本地磁盘 + 任意数量的 S3 兼容对象存储桶。站点设置 → 添加存储时先选类型，按类型渲染对应表单：

| 类型 | 需填写 |
| --- | --- |
| Cloudflare R2 | Account ID（端点自动推导）+ Bucket + Access Key |
| 阿里云 OSS | Region（端点自动推导）+ Bucket + Access Key |
| 腾讯云 COS | Region（端点自动推导）+ Bucket + Access Key |
| S3 兼容（MinIO / Wasabi / B2 / 百度 BOS 等） | 自定义端点 + Region + Bucket + Access Key |

- 桶命名：只添加一个时直接显示类型名（如 `R2`），多个时带序号（`R2-1`、`OSS-2`…）；可自定义显示名，侧栏卡片 / 筛选按钮 / 迁移页徽标统一使用
- 每张图片记录实际存放位置（`local` 或 `r2:<下标>`），切换配置或删除桶不影响已存文件
- 上传目标可任选一个桶；新上传进入当前选定位置
- 桶同步：每 30 秒自动对账桶内对象 ⇋ 数据库记录（收录新文件 / 移除孤儿记录），并提供手动一致性校验与清理
- 迁移（`/admin/migrate`）：选源与目标 → 真实连通性测试 → 逐张勾选（跨页保持选中）或全部迁移 → 进度轮询；逐张「读源 → 写目标 → 更新记录 → 删源文件」，失败留在原位可重试，任务幂等

## 上传与分片

- 单文件上限：站点设置中可调（1–512MB），受部署级天花板 `MAX_UPLOAD_MB` 约束（取两者较小值）
- **大文件自动分片**：超过 16MB 自动切换分片上传，5MB/片（前端切片、服务端落盘临时目录 `.chunks/`）
- **内存占用恒为单片**：合并阶段流式计算 sha256 并拼接，视频流式直传存储（`putStream`），512MB 视频全程不整读内存
- **断点续传**：uploadId 存 localStorage（文件名 + 大小 + 修改时间识别同一文件），刷新页面或失败重试时只补缺片；单片失败自动重试；手动移除后重新添加同一文件可续传
- 分片会话 24 小时无活动自动清理（分片目录 + 记录），不泄漏磁盘
- 去重、配额、审核状态与普通上传完全一致

## 安全模型

- 首页即登录页，全站内容（画廊 / 动态 / 用户主页 / 相册 / 图片详情）仅登录用户可访问
- 图片二进制一律经 `/api/images/[id]/raw|thumb|download` 受保护路由获取
- 仅 `PUBLIC` 的 raw/thumb 对匿名放开并携带 `Cache-Control: public` 以启用 CDN 与浏览器缓存；`UNLISTED`（友链）直链需登录任意账户，`PRIVATE` 与 download 始终需要登录
- 上传经限流 + MIME + 魔数双校验；分片上传含会话归属校验（防 IDOR）与分片下标白名单（防路径拼接）
- 同源校验（`assertSameOrigin`）防 CSRF

> 项目经过一次全面渗透测试（静态审查全部 API 路由 + 43 项动态用例：越权 / 横向访问 / 管理接口 / CSRF / SSRF / 路径穿越 / 上传滥用 / 限流），以下加固已落地：

- **登录防暴力猜解**：按邮箱维度限流（10 次/分钟），触发后前端明确提示「过于频繁」而非「密码错误」；封禁账号登录同样给出明确文案
- **管理接口双保险**：`/api/admin/images*`（图片审核）在中间件放行两级管理员，其余 `/api/admin/*`（用户 / 设置 / 存储 / 备份 / 日志）仅放行超级管理员——即使未来某个管理路由漏写守卫也不会裸奔
- **SSRF 防护**（URL 远程抓取）：仅允许 http(s)；字面量 IP 与 DNS 解析结果均校验私网 / 保留段（含云元数据 169.254.169.254、IPv4-mapped IPv6 等绕过形态）；重定向逐跳重新校验（`redirect: "manual"`，最多 3 跳）
- **路径穿越**：本地存储 key 解析强制落在存储根目录之内（防 `/app/storage-evil` 类前缀绕过）；分片会话 id 白名单校验；备份还原解包依赖 tar 的 `preservePaths: false` 兜底
- **机密保护**：R2 Secret / SMTP 授权码永不下发浏览器（置空 + `has*` 标记，留空提交即保持原值）；Redis 地址 AES-256-GCM 加密落库；备份文件包含密文，不会泄漏明文
- **越权（IDOR）**：全部资源操作在服务层校验归属（本人或管理员）；跨页全选只返回本人图片 id；分片会话限本人读写
- **限流 IP 来源**：默认不信任 `X-Forwarded-For` 等代理头（可伪造），退化为全局键；反代部署设 `TRUST_PROXY=1` 后按真实客户端 IP 精细限流（见[环境变量](#环境变量)）
- **管理员保护**：不能封禁或删除自己；站点至少保留一个超级管理员；最后一个管理员不能降级；管理员级账号（含超管）需先降级再删除

### 可见性模型

| 级别 | 页面访问 | raw/thumb 直链 |
| --- | --- | --- |
| `PUBLIC` | 所有登录用户（进画廊） | 登录 + 匿名均可，可作外链 |
| `UNLISTED`（友链） | 所有登录用户（不进画廊） | 仅登录可见（未登录 401） |
| `PRIVATE` | 仅本人、超级管理员与已获授权用户 | 仅本人、超级管理员与已获授权用户 |

download 接口始终需要登录，不生成匿名直链 / 签名 URL。用户间授权（交换图片申请-审批通过）仅放宽页面与直链的 `PRIVATE` 可见性，待审核图片始终不对他人可见。

## 安装 / 更新 / 卸载

只需 `postgres` + `web` 两个容器，web 镜像由 GitHub Actions 自动构建并发布到 GHCR，**无需在服务器上构建**。

### 安装（一键，推荐）

在服务器上执行一条命令（自动安装 Docker、拉取镜像并启动）：

```bash
curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/install.sh | bash
```

**交互终端执行时会依次问答 6 项**，全部支持直接回车取默认值：

| # | 问答项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 1/6 | 安装目录 | `~/ImageHub` | 输入 `~` 开头路径自动展开 |
| 2/6 | 服务端口 | `3000` | 自动校验 1-65535 |
| 3/6 | 端口绑定地址 | `127.0.0.1` | 仅本机（配合反向代理）；`0.0.0.0` 对外网开放 |
| 4/6 | 站点对外访问地址 | `http://公网IP:端口` | 自动探测公网 IP；反代场景填 `https://img.example.com` |
| 5/6 | 数据库密码 | 留空自动生成 64 位随机密码 | 至少 8 位，写入 `.env` 的 `POSTGRES_PASSWORD` |
| 6/6 | 是否启用 Redis | 不启用 | 限流计数落 Redis，多实例或需重启不丢失时建议启用 |

会话密钥 `AUTH_SECRET` 始终自动随机生成（64 位十六进制），不询问、不需手动配置。问答结束后打印配置确认面板再开始安装；安装完成后自动下载 `manage.sh` 管理脚本到安装目录。

**非交互场景**（`curl | bash`、CI、脚本化部署）全部取默认值，或用环境变量预设跳过对应问答：

```bash
SITE_URL=https://img.example.com PORT=8080 IMAGEHUB_DIR=/opt/ImageHub \
BIND_IP=0.0.0.0 POSTGRES_PASSWORD=YourPass123 REDIS_ENABLED=1 bash install.sh
```

| 预设变量 | 对应问答 |
| --- | --- |
| `IMAGEHUB_DIR` | 1/6 安装目录 |
| `PORT` | 2/6 服务端口 |
| `BIND_IP` | 3/6 端口绑定地址 |
| `SITE_URL` | 4/6 站点对外访问地址 |
| `POSTGRES_PASSWORD` | 5/6 数据库密码（不设则随机生成） |
| `REDIS_ENABLED=1` | 6/6 启用 Redis（写 `REDIS_URL` 并随栈启动 redis 容器） |

- **端口默认仅绑定 `127.0.0.1`（只有本机能打开）**；要公网直接访问问答填 `0.0.0.0`，或安装后 `bash manage.sh expose` 切换（见「端口暴露与防火墙」）
- 重复执行安全：已有 `.env` 时沿用现有配置，不会覆盖密钥

### 安装（手动，等价步骤）

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

默认仅本机可访问（`127.0.0.1`）：在这台机器上打开 `http://localhost:3000`，**注册的第一个账号自动成为超级管理员（站长）**，随后进入 `/admin` 建议关闭开放注册。要让其他设备访问，见「端口暴露与防火墙」或「反向代理与 HTTPS」。

### 可选：启用 Redis

限流默认使用进程内存实现，单实例足够；多实例部署或需要限流计数重启不丢失时可启用 Redis。**两层开关，任一层关闭都会安全降级为内存限流**：

**第一层：应用开关（站点设置，随时切、免重启）**

后台「站点设置 → Redis 缓存」：打开「启用 Redis」开关、填连接地址、点卡片内「保存配置」即生效；「测试当前配置」/「测试上方地址」可验证连通性，状态徽标实时显示（已连接 / 未启用 / 连接失败 · 已降级内存）。

- 地址格式：`redis://default:密码@主机:端口`（Redis 6+ 默认用户名 `default`；本机实例可用 `127.0.0.1`）
- 站点设置里填了地址则优先生效；留空回退环境变量 `REDIS_URL`

**第二层：容器开关（Docker 同栈，可选）**

```bash
bash manage.sh redis     # 菜单 16：自动写 .env REDIS_URL 并启动 redis 容器
# 或手动：.env 设 REDIS_URL=redis://redis:6379 后
docker compose --profile redis up -d
```

不启用容器时 `docker compose up -d` 只起 web + postgres，无 Redis 依赖。也可以不装容器、直接在站点设置里填一个外部 Redis 地址（如另一台服务器上的实例），效果相同。安装时问答 6/6 选 `y` 可一步到位。

### 管理脚本（推荐）

安装后（install.sh 会自动下载到安装目录），在服务器上进入安装目录执行：

```bash
cd ~/ImageHub && bash manage.sh
```

交互菜单覆盖 19 项日常运维，也支持子命令直达（如 `bash manage.sh update`）：

| 菜单 | 功能 | 子命令 |
| --- | --- | --- |
| 1 | 更新并清理旧镜像（拉取新镜像 + 重建容器 + 清理本项目旧版本镜像） | `update` |
| 2 | 卸载（双重确认，可选保留 backups/ 备份文件） | `uninstall` |
| 3 | 更改端口（自动改 `.env` 并同步 `SITE_URL` 中的端口，重建容器） | `port` |
| 4 | 修改站点地址（校验 http/https 前缀，找回密码等邮件链接随之更新） | `siteurl` / `url` |
| 5 | 重置用户密码（邮箱定位，直接回车自动生成 12 位随机密码） | `password` |
| 6 | 角色管理：设为超级管理员 / 管理员 / 降为普通用户 | `admin` / `role` |
| 7 | 用户列表（邮箱 / 昵称 / 角色 / 状态 / 图片数 / 注册日期，最多 50 条） | `users` / `list` |
| 8 | 服务 启动 / 停止 / 重启 | `service` |
| 9 | 查看实时日志 | `logs` |
| 10 | 备份数据（数据库 pg_dump + 存储卷打包，存入 `backups/`） | `backup` |
| 11 | 还原数据（从脚本生成的备份回滚，需配套的存储备份） | `restore` |
| 12 | 每日自动备份定时任务（crontab 安装 / 移除，默认每天 04:00） | `cron` / `backup-cron` |
| 13 | 端口对外开放 / 仅本机 切换（改 `BIND_IP` 重建容器） | `expose` |
| 14 | 清理本项目旧镜像、查看 Docker 磁盘占用 | `cleanup` |
| 15 | 站点信息（地址 / 绑定 / 容器状态 / 存储占用 / 备份目录） | `info` |
| 16 | Redis 启用 / 停用（写 `.env` + 启停 redis 容器，应用侧开关在站点设置） | `redis` |
| 17 | 数据库控制台（进入 PostgreSQL psql 交互终端） | `db` / `psql` |
| 18 | 拉取新镜像不重启（对比镜像 ID，提示是否有新版本） | `pull` / `check-update` |
| 19 | 强制重建容器（`up -d --force-recreate`，改完 compose/env 后用） | `recreate` |

> 角色管理（菜单 6）撤销超级管理员前会检查站点剩余超管数量：仅剩一个时拒绝操作，保证站点始终至少有一个超级管理员。

> 老版本安装的站点可手动补拉一次：`cd ~/ImageHub && curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/manage.sh -o manage.sh && chmod +x manage.sh`；git clone 安装的站点在菜单 1 更新时自动同步最新脚本。

### 更新

镜像由 CI 自动构建发布，服务器上一条命令完成升级（数据卷不受影响）：

```bash
cd ~/ImageHub && bash manage.sh update
# 等价手动步骤：
cd ~/ImageHub && docker compose pull web && docker compose up -d && docker image prune -f
```

> 末尾的镜像清理只删被替换下来的本项目旧版本悬空镜像（按仓库路径 / source label 识别），其他项目的镜像与构建缓存不受影响。每次 `pull` 都会留下一个约几百 MB 的旧镜像，Docker 不会自动删除，长期不清理会持续吃掉磁盘空间。

### 卸载

在安装目录执行一条命令，停止并删除容器、数据卷、镜像与项目文件：

```bash
cd ~/ImageHub && docker compose down -v --rmi all; rm -rf ~/ImageHub
```

说明：

- `down -v`：停止并删除容器，同时删除 `imagehub_postgres_data`（用户与图片元数据）和 `imagehub_storage_data`（图片文件），**不可恢复**
- `--rmi all`：顺带删除本 compose 拉取的镜像（应用镜像、postgres、redis；如其他项目共用同一镜像会被一并删除）
- `rm -rf`：删除项目目录（含 `.env` 与 `docker-compose.yml`）

> 如需保留数据，卸载前先按「数据持久化与备份」章节备份两个数据卷；或直接用菜单 2 卸载（双重确认，可选保留 backups/）。

## 环境变量

见 [.env.example](.env.example)（含注释）。关键字段：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 站点对外地址（用于生成站内链接），如 `https://img.example.com` |
| `AUTH_SECRET` | ✅ | 会话加密密钥，`openssl rand -base64 32` 生成，≥32 字符 |
| `POSTGRES_PASSWORD` | Docker 部署 | 数据库密码，install.sh 问答生成；compose 据此拼接 `DATABASE_URL` |
| `DATABASE_URL` | ✅ | 本地开发 `file:./dev.db`；Docker 部署由 compose 注入 PostgreSQL |
| `BIND_IP` | - | 端口绑定地址，默认 `127.0.0.1` 仅本机；`0.0.0.0` 对外网开放（见「端口暴露与防火墙」） |
| `PORT` | - | 宿主机监听端口，默认 3000 |
| `LOCAL_STORAGE_DIR` | - | 本地存储目录，容器内为 `/app/storage`，默认 `./storage` |
| `MAX_UPLOAD_MB` | - | 单文件上限的部署级天花板（MB），实际生效 = min(界面设置, 此值)，默认 512 |
| `CONVERT_TO_WEBP` | - | 是否自动将 jpg/png 转 WebP，默认 false |
| `REDIS_URL` | - | 可选，Redis 连接地址兜底（站点设置里的地址优先）；两者都没有时限流降级进程内存 |
| `TRUST_PROXY` | - | 部署在 nginx 等反代之后时设为 `1`：限流按 `X-Real-IP` / `X-Forwarded-For` 最右一跳取真实客户端 IP（建议反代配置 `proxy_set_header X-Real-IP $remote_addr;`）；不设则不信任代理头、按全站共享窗口限流（防伪造头轮换绕过） |

邮件发送：后台「站点设置 → 邮件配置」填写 SMTP 后，验证 / 重置邮件真实发送；未配置时打印到服务端控制台。

## 端口暴露与防火墙

Docker 发布端口**不走系统防火墙**，这是 Docker 的设计而非防火墙失效：

- Linux 上 `ports: "3000:3000"` 会让 Docker 直接在 iptables 的 NAT/DOCKER 链写转发规则，流量不经过 ufw / firewalld 管理的 INPUT 链，所以防火墙规则拦不住它
- Windows / macOS 的 Docker Desktop 由 `com.docker.backend` 进程代理端口，而该进程安装时已被防火墙放行

因此暴露与否由**绑定地址**决定（`docker-compose.yml` 的 `BIND_IP`，默认 `127.0.0.1`）：

| `BIND_IP` | 效果 | 适用 |
| --- | --- | --- |
| `127.0.0.1`（默认） | 端口只在回环监听，**无论防火墙如何，外网都打不开** | 本机使用 / 反向代理（推荐） |
| `0.0.0.0` | 监听所有网卡，外网可直接访问 | 确认要裸暴露时（建议配防火墙/安全组限源） |

切换方式：编辑 `.env`（或安装问答 3/6 直接选），然后 `docker compose up -d` 重建容器：

```bash
# 对外网开放
BIND_IP=0.0.0.0 docker compose up -d
# 收回仅本机
BIND_IP=127.0.0.1 docker compose up -d
```

也可以 `bash manage.sh expose` 交互切换（菜单 13）。公网部署推荐保持默认 `127.0.0.1`，用反向代理对外提供 80/443 与 HTTPS，应用端口不出主机。

## 反向代理与 HTTPS

`SITE_URL` 需配置为对外地址（含协议），例如 `https://img.example.com`。使用 Caddy 示例：

```caddyfile
img.example.com {
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 512MB
    }
}
```

Nginx 需注意调整 `client_max_body_size`（如 `client_max_body_size 512m;`），不小于站点设置中的「单文件上传上限」。

## 数据持久化与备份

| 卷 | 内容 |
| --- | --- |
| `imagehub_postgres_data` | 数据库（用户 / 图片元数据 / 相册等） |
| `imagehub_storage_data` | 图片与视频原始文件、缩略图、分片临时目录 |

备份：

```bash
docker compose exec -T postgres pg_dump -U imagehub imagehub > backup.sql
docker run --rm -v imagehub_storage_data:/data -v $PWD:/backup alpine tar czf /backup/storage.tgz -C /data .
```

恢复：先 `docker compose down`，还原两个卷后 `docker compose up -d`。

站点设置内置「备份 / 还原」：超级管理员可一键下载整包备份（数据库 + 全部存储文件，tar.gz），或上传备份整包还原。

**服务器侧备份（推荐）**：

```bash
bash manage.sh backup    # 菜单 10：数据库 + 存储打包到 backups/，带时间戳
bash manage.sh cron      # 菜单 12：安装每天 04:00 自动备份的 crontab（日志写 backups/backup.log）
```

### 常用命令

```bash
docker compose ps                 # 查看状态（web 应为 healthy）
docker compose logs -f web        # 实时日志
docker compose down               # 停止（保留数据）
docker compose down -v            # 停止并清空全部数据（慎用，会删除图片文件）
```

## 忘记密码

**方式一：站内「忘记密码」流程（推荐）**

未配置 SMTP 时邮件会打印到 web 容器日志，同样能拿到重置链接：

1. 登录页点「忘记密码」，输入邮箱提交
2. 服务器上查看日志获取重置链接（1 小时内有效）：

```bash
docker compose logs web --tail 100 | grep -A 4 "邮件预览"
```

3. 浏览器打开日志里的 `https://<SITE_URL>/reset-password?token=...` 设置新密码

> 前提：`.env` 的 `SITE_URL` 已配置为真实对外地址，否则手动把链接主机部分改成 `服务器IP:3000`（或 `bash manage.sh siteurl` 修改）。

**方式二：管理脚本重置（最简单）**

```bash
bash manage.sh password   # 菜单 5：输入邮箱，回车自动生成随机密码
```

**方式三：直接改数据库（邮件流程不可用时兜底）**

```bash
# 1. 用应用容器里的 bcryptjs 生成新密码哈希（把 NewPass123 换成新密码）
HASH=$(docker compose exec web node -e "console.log(require('bcryptjs').hashSync('NewPass123', 12))")

# 2. 写入数据库（把邮箱换成自己的）
docker compose exec postgres psql -U imagehub -d imagehub \
  -c "UPDATE \"User\" SET \"passwordHash\" = '$HASH' WHERE email = '你的邮箱';"
```

日常改密码直接在「个人中心 → 修改密码」操作即可。

## 本地开发

```bash
npm install          # 自动生成 Prisma 客户端（SQLite schema）
npm run db:push      # 建表（SQLite）
npm run dev          # http://localhost:3000
```

- 数据库：SQLite（`prisma/schema.dev.prisma`，文件 `prisma/dev.db`）
- 存储：本地磁盘 `./storage`
- 验证 / 重置邮件：打印到 dev server 控制台

生产模式本地验证：`npm run build && npm start`（注意 build 脚本使用 SQLite schema 生成客户端，仅适合本地）。

### 双 Schema 说明

- `prisma/schema.prisma` —— PostgreSQL（Docker / 生产），迁移文件基于它生成
- `prisma/schema.dev.prisma` —— SQLite（本地开发），模型与生产完全一致
- 为兼容两者，状态字段（role / status / visibility）使用 String + 应用层校验（zod），而非数据库枚举
- 模型变更需同步修改两个 schema，并在 `prisma/migrations/` 新增迁移目录

## CI/CD

推送到 `main` 或 `final-review` 分支后，GitHub Actions 自动执行 Docker 多阶段构建（deps → build → runner），镜像发布为：

```
ghcr.io/yssz-ink/imagehub:latest
ghcr.io/yssz-ink/imagehub:sha-<commit>
```

服务器上 `docker compose pull web && docker compose up -d` 即完成升级。

## 项目结构与页面路由

```
imagehub/
├── prisma/
│   ├── schema.prisma          # PostgreSQL schema（生产）
│   ├── schema.dev.prisma      # SQLite schema（本地开发）
│   └── migrations/            # PostgreSQL 迁移
├── public/                    # 水墨背景图（ink-1~4.png）等静态资源
├── src/
│   ├── app/                   # 页面与 API 路由（App Router，登录页统一在 (console) 路由组）
│   ├── components/            # UI 组件（图片网格 / 灯箱 / 上传 / 水墨主题等）
│   ├── server/                # 业务逻辑（image / storage / migration / chunk-upload 等服务）
│   ├── lib/                   # 会话 / zod 校验 / 存储驱动 / 分片与缩略图缓存 / 限流
│   └── middleware.ts          # ink-bg cookie 会话固定背景图
├── install.sh                 # 一键安装脚本（交互问答）
├── manage.sh                  # 站点管理脚本（19 项菜单 + 子命令）
├── Dockerfile                 # 多阶段构建（deps → build → runner）
└── docker-compose.yml         # web + postgres（可选 redis profile）
```

| 地址 | 页面 | 可见性 |
| --- | --- | --- |
| `/` | 落地页（登录 / 注册入口） | 公开 |
| `/gallery` | 公共画廊 | 登录 |
| `/feed` | 图文动态 | 登录 |
| `/images`、`/images/[id]` | 我的图片 / 图片详情 | 登录（详情按可见性） |
| `/albums`、`/albums/[id]` | 相册管理 / 相册页 | 登录（按可见性） |
| `/albums/daily` | 日常记录（动态照片汇总） | 管理员（ADMIN / SUPERADMIN） |
| `/trash` | 回收站 | 登录 |
| `/settings` | 个人中心（含图片访问授权审批） | 登录 |
| `/users` | 交换图片（授权用户切换浏览 + 用户目录申请） | 登录 |
| `/users/[username]` | 指定用户图片浏览（授权后） | 登录 |
| `/u/[username]` | 用户主页 | 登录 |
| `/admin`、`/admin/images` | 统计面板 / 图片审核 | 管理员（ADMIN / SUPERADMIN） |
| `/admin/users`、`/admin/migrate`、`/admin/settings` | 用户管理 / 存储迁移 / 站点设置 | 仅超级管理员（SUPERADMIN） |

## 故障排查

**部署后看不到水墨背景图 / `/ink-1.png` 404**
Dockerfile 必须在 runner 阶段显式拷贝 `COPY --from=build /app/public ./public` —— Next.js standalone 输出不包含 public 目录（当前版本已内置）。

**`docker compose build` 卡住不动**
构建需要从 Docker Hub 拉取基础镜像，国内服务器通常无法直连。本项目镜像已由 CI 发布到 GHCR，直接 `docker compose pull web` 即可，无需本地构建；镜像拉取失败多为 DNS 污染，配置可用的镜像加速器或使用代理。

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

**web 容器启动报 `MODULE_NOT_FOUND: effect` 或首查数据库报错**
镜像内 Prisma 客户端与 schema 不匹配。确认构建流程先生成 PostgreSQL 客户端（`npx prisma generate --schema prisma/schema.prisma`）再 `next build`。

**上传失败提示超限**
实际生效上限 = min(站点设置「单文件上传上限」, `MAX_UPLOAD_MB`)。检查站点设置中的上限值；再检查反代的请求体大小限制（Nginx `client_max_body_size` / Caddy `request_body.max_size`）不小于该值（如 `client_max_body_size 512m;`）。分片上传同样受此上限约束。

**画廊 / 视频加载慢**
确认对象存储桶的连通性（站点设置中「测试连接」）；视频播放与首帧走流式 Range，若反代缓存了带 Range 的请求请关闭对该路径的缓冲（Nginx `proxy_buffering off` 对 `/api/images/` 更稳妥）。

## License

本项目基于 [GPL-3.0](LICENSE) 协议开源。
