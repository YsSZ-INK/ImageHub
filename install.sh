#!/usr/bin/env bash
# ============================================================
# ImageHub 一键安装脚本
#
# 用法（服务器上执行一条命令完成安装）：
#   curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/install.sh | bash
#
# 可选环境变量（非交互场景预设）：
#   SITE_URL=http://img.example.com PORT=3000 INSTALL_DIR=/opt/ImageHub bash install.sh
# ============================================================
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main"
INSTALL_DIR="${IMAGEHUB_DIR:-$HOME/ImageHub}"
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

# ---------- 交互式收集配置（curl|bash 等非交互场景使用默认值） ----------
ask() { # ask 变量名 提示语 默认值
  if [ -n "${!1:-}" ]; then return; fi        # 已通过环境变量预设
  if [ -t 0 ]; then                            # 交互终端才询问
    read -rp "$2 [$3]: " _v || _v=""
    eval "$1=\"\${_v:-$3}\""
  else
    eval "$1=\"$3\""
  fi
}

if [ ! -t 0 ] && [ -z "${SITE_URL:-}" ]; then
  PUB_IP="$(curl -4 -fsS --max-time 3 https://ifconfig.me 2>/dev/null || true)"
  [ -n "$PUB_IP" ] && SITE_URL="http://${PUB_IP}:${DEFAULT_PORT}"
fi
ask PORT        "服务端口"            "$DEFAULT_PORT"
ask SITE_URL    "站点对外访问地址"    "http://$(curl -4 -fsS --max-time 3 https://ifconfig.me 2>/dev/null || echo 127.0.0.1):${PORT}"
case "$SITE_URL" in http://*|https://*) ;; *) SITE_URL="http://${SITE_URL}" ;; esac
# 绑定地址：127.0.0.1 仅本机可访问（配合反向代理），0.0.0.0 对外网开放
# Docker 发布端口不走系统防火墙（iptables DOCKER 链 / Docker Desktop 进程放行），暴露与否只能由绑定地址决定
ask BIND_IP     "端口绑定地址（127.0.0.1=仅本机，0.0.0.0=对外开放）" "127.0.0.1"

# 安装目录：交互时询问，非交互（curl|bash）用默认值；可用环境变量 IMAGEHUB_DIR 预设
INSTALL_DIR="${IMAGEHUB_DIR:-${INSTALL_DIR:-}}"
ask INSTALL_DIR "安装目录" "$HOME/ImageHub"
case "$INSTALL_DIR" in "~"*) INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}" ;; esac

# ---------- 生成密钥 ----------
gen_key() { openssl rand -hex 32 2>/dev/null || od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
AUTH_SECRET="$(gen_key)"
POSTGRES_PASSWORD="$(gen_key)"

# ---------- 下载 compose 并写入 .env ----------
log "安装目录：${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ -f .env ]; then
  warn ".env 已存在，沿用现有配置（如需重置请删除 ~/ImageHub/.env 后重跑）"
else
  cat > .env <<EOF
SITE_URL="${SITE_URL}"
AUTH_SECRET="${AUTH_SECRET}"
PORT="${PORT}"
BIND_IP="${BIND_IP}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD}"
EOF
  log ".env 已生成（AUTH_SECRET 与数据库密码均为随机值）"
fi

log "拉取 docker-compose.yml …"
curl -fsSL "$REPO_RAW/docker-compose.yml" -o docker-compose.yml

# ---------- 启动 ----------
log "拉取镜像并启动（首次启动自动执行数据库迁移）…"
${SUDO} docker compose pull web
${SUDO} docker compose up -d

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
if [ "${BIND_IP:-127.0.0.1}" = "127.0.0.1" ]; then
  log "当前端口仅绑定本机（127.0.0.1）：只有这台机器能打开，外网无法访问"
  log "对外网开放：编辑 ${INSTALL_DIR}/.env 设 BIND_IP=0.0.0.0 后执行 docker compose up -d"
  log "公网部署推荐：保持默认绑定 + 反向代理（Caddy/Nginx）提供 HTTPS"
else
  warn "端口已绑定 0.0.0.0，服务直接暴露在所有网卡：请确认防火墙/安全组已限制来源端口"
fi
log "注册的第一个账号自动成为管理员，随后到「站点设置」建议关闭开放注册"
log "更新：cd ${INSTALL_DIR} && docker compose pull web && docker compose up -d"
log "卸载：cd ${INSTALL_DIR} && docker compose down -v --rmi all; rm -rf ${INSTALL_DIR}"
log "──────────────────────────────────────────────"
