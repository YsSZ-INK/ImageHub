#!/usr/bin/env bash
# ============================================================
# ImageHub 一键安装脚本（交互式问答）
#
# 用法（服务器上执行一条命令完成安装）：
#   curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/install.sh | bash
#
# 交互终端下会依次询问：
#   1) 安装目录          默认 ~/ImageHub
#   2) 服务端口          默认 3000（自动校验 1-65535）
#   3) 端口绑定地址      默认 127.0.0.1（仅本机，配合反向代理）
#   4) 站点对外访问地址  默认 http://公网IP:端口
#   5) 数据库密码        留空自动生成 64 位随机密码
#   6) 是否启用 Redis    默认不启用（限流自动降级进程内存）
#   会话密钥 AUTH_SECRET 始终自动随机生成，不询问。
#
# 非交互场景（curl|bash / CI / 脚本化部署）全部取默认值，或用环境变量预设：
#   SITE_URL=https://img.example.com PORT=8080 IMAGEHUB_DIR=/opt/ImageHub \
#   BIND_IP=0.0.0.0 POSTGRES_PASSWORD=YourPass123 REDIS_ENABLED=1 bash install.sh
# ============================================================
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main"
DEFAULT_PORT="3000"

log()  { printf '\033[1;32m[ImageHub]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[提示]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 提权：非 root 且无 docker 组权限时用 sudo ----------
SUDO=""
if [ "$(id -u)" != "0" ]; then
  if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null 2>&1 || err "需要 root 权限或已安装 sudo"
    SUDO="sudo"
  fi
fi

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  log "未检测到 Docker，开始自动安装（约 1-3 分钟）…"
  curl -fsSL https://get.docker.com | ${SUDO} sh
  ${SUDO} systemctl enable --now docker 2>/dev/null || true
fi
${SUDO} docker compose version >/dev/null 2>&1 || err "Docker Compose 插件不可用，请升级 Docker"

# ---------- 问答工具 ----------
# ask 变量名 提示语 默认值：环境变量已预设时跳过；非交互终端直接取默认值
ask() {
  if [ -n "${!1:-}" ]; then return; fi
  if [ -t 0 ]; then
    read -rp "$2 [$3]: " _v || _v=""
    eval "$1=\"\${_v:-$3}\""
  else
    eval "$1=\"$3\""
  fi
}

gen_key() { openssl rand -hex 32 2>/dev/null || od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }

# ---------- 1) 安装目录 ----------
INSTALL_DIR="${IMAGEHUB_DIR:-}"
ask INSTALL_DIR "1/6 安装目录" "$HOME/ImageHub"
case "$INSTALL_DIR" in "~"*) INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}" ;; esac

# ---------- 2) 服务端口 ----------
ask PORT "2/6 服务端口" "$DEFAULT_PORT"
case "$PORT" in ''|*[!0-9]*) err "端口必须是数字" ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || err "端口需在 1-65535 之间"

# ---------- 3) 端口绑定地址 ----------
# 绑定地址决定暴露与否：Docker 发布端口不走系统防火墙（iptables DOCKER 链 / Docker Desktop 放行）
ask BIND_IP "3/6 端口绑定地址（127.0.0.1=仅本机，0.0.0.0=对外网开放）" "127.0.0.1"
case "$BIND_IP" in 127.0.0.1|0.0.0.0) ;; *) warn "非常规绑定地址：${BIND_IP}（一般填 127.0.0.1 或 0.0.0.0）" ;; esac

# ---------- 4) 站点对外访问地址 ----------
if [ -z "${SITE_URL:-}" ]; then
  PUB_IP="$(curl -4 -fsS --max-time 3 https://ifconfig.me 2>/dev/null || true)"
  if [ -n "$PUB_IP" ]; then SITE_URL="http://${PUB_IP}:${PORT}"; else SITE_URL="http://127.0.0.1:${PORT}"; fi
fi
ask SITE_URL "4/6 站点对外访问地址" "$SITE_URL"
case "$SITE_URL" in http://*|https://*) ;; *) SITE_URL="http://${SITE_URL}" ;; esac

# ---------- 5) 数据库密码 ----------
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  if [ -t 0 ]; then
    read -rp "5/6 数据库密码（留空自动生成 64 位随机密码）: " _p || _p=""
    POSTGRES_PASSWORD="${_p:-$(gen_key)}"
  else
    POSTGRES_PASSWORD="$(gen_key)"
  fi
fi
[ "${#POSTGRES_PASSWORD}" -ge 8 ] || err "数据库密码至少 8 位"

# ---------- 6) Redis ----------
if [ -z "${REDIS_ENABLED:-}" ] && [ -t 0 ]; then
  read -rp "6/6 是否启用 Redis 缓存？（多实例部署或需要限流计数重启不丢失时建议启用）[y/N]: " _r || _r=""
  case "${_r:-N}" in [yY]|[yY][eE][sS]) REDIS_ENABLED=1 ;; *) REDIS_ENABLED="" ;; esac
fi
REDIS_ENABLED="${REDIS_ENABLED:-}"

# ---------- 生成会话密钥（不询问，保证强度） ----------
AUTH_SECRET="$(gen_key)"

log ""
log "──────── 安装配置确认 ────────"
log "安装目录　　：${INSTALL_DIR}"
log "端口绑定　　：${BIND_IP}:${PORT}（容器内 3000）"
log "站点地址　　：${SITE_URL}"
log "数据库密码　：${POSTGRES_PASSWORD:0:4}********（已隐藏）"
log "会话密钥　　：随机生成"
log "Redis 缓存　：$([ -n "$REDIS_ENABLED" ] && echo '启用' || echo '不启用（限流走进程内存）')"
log "──────────────────────────────"

# ---------- 写入 .env ----------
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ -f .env ]; then
  warn ".env 已存在，沿用现有配置（如需重置请删除 .env 后重跑）"
  if [ -n "$REDIS_ENABLED" ] && ! grep -qE '^REDIS_URL=' .env; then
    printf 'REDIS_URL="redis://redis:6379"\n' >> .env
    log "已追加 REDIS_URL"
  fi
else
  {
    echo "SITE_URL=\"${SITE_URL}\""
    echo "AUTH_SECRET=\"${AUTH_SECRET}\""
    echo "PORT=\"${PORT}\""
    echo "BIND_IP=\"${BIND_IP}\""
    echo "POSTGRES_PASSWORD=\"${POSTGRES_PASSWORD}\""
    [ -n "$REDIS_ENABLED" ] && echo "REDIS_URL=\"redis://redis:6379\""
  } > .env
  log ".env 已生成（AUTH_SECRET 随机；数据库密码为自定义或随机值）"
fi

# ---------- 下载 compose 与管理脚本 ----------
log "拉取 docker-compose.yml 与管理脚本 …"
curl -fsSL "$REPO_RAW/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$REPO_RAW/manage.sh" -o manage.sh && chmod +x manage.sh

# ---------- 启动 ----------
log "拉取镜像并启动（首次启动自动执行数据库迁移）…"
${SUDO} docker compose pull web
if [ -n "$REDIS_ENABLED" ]; then
  ${SUDO} docker compose --profile redis up -d
else
  ${SUDO} docker compose up -d
fi

# ---------- 健康检查 ----------
log "等待服务就绪 …"
for i in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"ok":true'; then
    break
  fi
  [ "$i" = "60" ] && err "服务启动超时，请执行 docker compose logs web 查看日志"
  sleep 2
done

log "──────────────────────────────────────────────"
log "安装完成！访问地址：${SITE_URL}"
if [ "$BIND_IP" = "127.0.0.1" ]; then
  log "端口仅绑定本机：只有这台机器能打开，外网无法访问"
  log "对外网开放：bash manage.sh expose（或编辑 .env 设 BIND_IP=0.0.0.0 后 docker compose up -d）"
  log "公网部署推荐：保持默认绑定 + 反向代理（Caddy/Nginx）提供 HTTPS"
else
  warn "端口已绑定 0.0.0.0，服务直接暴露在所有网卡：请确认防火墙/安全组已限制来源端口"
fi
if [ -n "$REDIS_ENABLED" ]; then
  log "Redis 容器已启动：请到 站点设置 → Redis 缓存 打开「启用 Redis」开关"
fi
log "注册的第一个账号自动成为超级管理员（站长），随后到「站点设置」建议关闭开放注册"
log "管理：bash ${INSTALL_DIR}/manage.sh（19 项菜单：更新/备份/角色管理/定时备份/用户列表等）"
log "──────────────────────────────────────────────"
