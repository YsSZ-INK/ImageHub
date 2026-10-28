# ImageHub —— 自托管图床 + 画廊（严格私有模式）

Next.js 15 (App Router) + TypeScript + Prisma + Auth.js v5 + sharp + S3 兼容存储。

**核心安全模型**：首页即登录页；全站内容（画廊 / 用户主页 / 相册 / 图片详情 / 图片二进制）仅登录用户可访问；所有图片只能通过受保护路由 `/api/images/[id]/raw|thumb|download` 获取；不生成匿名直链 / 签名 URL / 公开桶地址；复制按钮只产出需登录的站内链接。

## 功能总览

- 用户：注册（密码强度校验 + bcrypt）、登录/登出、记住我、邮箱验证、找回密码（控制台/Resend 邮件）、个人中心（昵称/头像/密码/配额）、账号注销（级联清理存储）
- 图片：拖拽/点击/粘贴/URL 抓取上传、多文件并发 + 进度 + 重试、MIME + 魔数双校验、sha256 去重、EXIF 剥离、400px WebP 缩略图、blurhash、可选 WebP 转码、批量（删除/移动相册/打标签/改可见性）、回收站 30 天、相册、标签、搜索排序
- 可见性：`PUBLIC`（登录用户可见）/ `UNLISTED`（登录用户有链可见，不进画廊）/ `PRIVATE`（仅本人）
- 画廊：瀑布流/方格切换、分页、标签筛选、灯箱（键盘 ← → ESC / I）、用户主页、相册页
- 后台：用户管理（封禁/角色/配额）、图片审核（下架/删除）、统计面板（近 7 天趋势）、站点设置
- 其他：限流（Redis 可选，未配置降级内存）、深色模式、骨架屏、Toast、空状态

## 本地开发（无需 Docker）

```bash
npm install          # 自动生成 Prisma 客户端（SQLite schema）
npm run db:push      # 建表（SQLite）
npm run dev          # http://localhost:3000
```

- 数据库：SQLite（`prisma/schema.dev.prisma`，文件 `prisma/dev.db`）
- 存储：本地磁盘 `./storage`（`STORAGE_DRIVER=local`）
- 限流：内存实现（未配置 `REDIS_URL`）
- 验证/重置邮件：打印到 dev server 控制台

## Docker 部署（web + postgres + minio + redis）

```bash
# 1. 准备环境变量（务必修改密码与 AUTH_SECRET）
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

- 首次启动自动执行 `prisma migrate deploy`（迁移文件在 `prisma/migrations/`）
- MinIO 桶 `imagehub` 由 `minio-init` 创建，**默认私有**（无公开读策略）
- 生产替换：R2/OSS/S3 只需改 `S3_*` 环境变量，业务代码零改动（存储适配层隔离）
- MinIO 控制台 `9001` 端口仅供管理，生产建议关闭

### 常用命令

```bash
docker compose logs -f web      # 看日志
docker compose exec web sh      # 进容器
docker compose down -v          # 停止并清空数据（慎用）
```

## 环境变量

见 [.env.example](.env.example)（含注释）。关键字段：

| 变量 | 说明 |
| --- | --- |
| `SITE_URL` | 站点对外地址（生成站内链接） |
| `AUTH_SECRET` | 会话加密密钥（≥32 字符） |
| `DATABASE_URL` | 本地 `file:./dev.db`；Docker 由 compose 注入 PostgreSQL |
| `STORAGE_DRIVER` | `local` / `s3` |
| `S3_*` | S3 兼容存储连接信息（桶必须私有） |
| `MAX_UPLOAD_MB` | 单文件上限 |
| `CONVERT_TO_WEBP` | 是否自动转 WebP |
| `REDIS_URL` | 可选，未配置时限流降级为内存 |

## 双 Schema 说明

- `prisma/schema.prisma` —— PostgreSQL（Docker / 生产），迁移文件基于它生成
- `prisma/schema.dev.prisma` —— SQLite（本地预览），模型与生产完全一致
- 为兼容两者，状态字段（role/status/visibility）使用 String + 应用层校验，而非数据库枚举

## 验收清单（对应 PRD）

### 阶段二：认证与访问控制
- [ ] 未登录访问 `/` 显示登录/注册界面
- [ ] 未登录访问 `/gallery` 重定向到 `/?callbackUrl=/gallery`
- [ ] 未登录访问 `/api/images/xxx/raw` 返回 401
- [ ] 登录成功后进入 `/gallery`；已登录访问 `/` 自动跳转 `/gallery`
- [ ] 登出后再次访问 `/gallery` 与图片接口均被拦截

### 阶段三：上传与私有访问
- [ ] 上传后图片只能通过受保护路由访问
- [ ] 未登录访问 raw/thumb 返回 401
- [ ] PRIVATE 图片他人不可见（403）；登录用户可访问 PUBLIC/UNLISTED
- [ ] 复制按钮只生成站内需登录链接（无匿名直链）

### 阶段四：管理
- [ ] 多选批量删除/移动相册/打标签/改可见性
- [ ] 回收站恢复/彻底删除，30 天自动清理
- [ ] 相册与标签增删改

### 阶段五：画廊
- [ ] 画廊仅展示 PUBLIC 图片；UNLISTED 不进列表但有链可访问
- [ ] 灯箱键盘操作；下载走受保护接口
- [ ] 页面源代码无匿名直链 / 公开桶 URL

### 阶段六：后台
- [ ] `/admin` 仅 ADMIN 可访问（其他人被重定向）
- [ ] 用户封禁/解封、角色调整、配额调整
- [ ] 图片下架（改 PRIVATE）与彻底删除
- [ ] 统计面板与站点设置生效（关闭注册后注册接口 403）
