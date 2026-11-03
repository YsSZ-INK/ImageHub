#!/usr/bin/env bash
# ============================================================
# ImageHub 一键安装脚本（交互式问答）
#
# 用法（服务器上执行一条命令完成安装）：
#   curl -fsSL https://raw.githubusercontent.com/YsSZ-INK/ImageHub/main/install.sh | bash
#
# 交互终端下会依次询问（每一步直接回车即取默认值）：
#   1) 安装目录          默认 ~/ImageHub
#   2) 服务端口          默认 3000（自动校验 1-65535）
#   3) 端口绑定地址      默认 127.0.0.1（仅本机，配合反向代理）
#   4) 站点对外访问地址  默认 http://公网IP:端口
#   5) 登录回调地址      AUTH_URL，回车=自动推断；域名 + HTTPS 部署建议填 https://域名
#   6) 数据库密码        留空自动生成 64 位随机密码
#   7) 图片上传上限      默认 512 MB（1-512）
#   8) 是否自动转 WebP   默认否
#   9) 是否启用 Redis    默认不启用（限流自动降级进程内存）
#   最后确认配置再开始安装
#   启动成功后 10) 引导立即注册站长账号：第一个注册的账号自动成为超级管理员，
#   请求会自动携带脚本生成的首注册门控令牌（SETUP_TOKEN），防止服务就绪到
#   站长注册之间的窗口被公网陌生人抢注超管。
#   会话密钥 AUTH_SECRET 与 SETUP_TOKEN 始终自动随机生成，不询问。
#
# curl | bash 同样可以交互：脚本通过 /dev/tty 读取输入，不依赖标准输入；
# 只有在完全没有终端（CI / 远程非交互）时才全部取默认值，可用环境变量预设：
#   SITE_URL=https://img.example.com AUTH_URL=https://img.example.com PORT=8080 \
#   IMAGEHUB_DIR=/opt/ImageHub BIND_IP=0.0.0.0 POSTGRES_PASSWORD=YourPass123 \
#   MAX_UPLOAD_MB=256 CONVERT_TO_WEBP=1 REDIS_ENABLED=1 bash install.sh
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

# ---------- 交互输入通道 ----------
# 直接执行脚本时 stdin 就是终端；curl | bash 时 stdin 是脚本管道（[ -t 0 ] 为假），
# 但进程仍挂在终端上——此时单独打开 /dev/tty 作为输入源，保证仍能逐项询问，
# 且不会把脚本文本当成用户输入吞掉。
TTY_FD=""
if [ -t 0 ]; then
  TTY_FD=0
elif : 2>/dev/null </dev/tty; then
  # 先静音 stderr 再打开 /dev/tty：没有终端时不会往日志里吐报错
  exec 3</dev/tty
  TTY_FD=3
fi
INTERACTIVE=""
[ -n "$TTY_FD" ] && INTERACTIVE=1

_ANS=""
# read_line 提示语 [secret]：读一行到 _ANS；无终端时返回非 0（调用方取默认值）
read_line() {
  local _prompt="$1" _mode="${2:-}" _v=""
  [ -n "$INTERACTIVE" ] || return 1
  if [ "$TTY_FD" = "0" ]; then
    if [ "$_mode" = "secret" ]; then read -rsp "$_prompt" _v || _v=""; echo ""
    else read -rp "$_prompt" _v || _v=""; fi
  else
    if [ "$_mode" = "secret" ]; then read -r -s -u "$TTY_FD" -p "$_prompt" _v || _v=""; echo ""
    else read -r -u "$TTY_FD" -p "$_prompt" _v || _v=""; fi
  fi
  _ANS="$_v"
  return 0
}

# ---------- 问答工具 ----------
# ask 变量名 提示语 默认值：环境变量已预设时跳过；直接回车取默认值
ask() {
  local _var="$1" _prompt="$2" _def="$3" _v=""
  if [ -n "${!_var:-}" ]; then return; fi
  if read_line "$_prompt [$_def]: "; then _v="$_ANS"; fi
  printf -v "$_var" '%s' "${_v:-$_def}"
}

# ask_num 变量名 提示语 默认值 最小值 最大值：非数字或越界时重新询问
ask_num() {
  local _var="$1" _prompt="$2" _def="$3" _min="$4" _max="$5" _v=""
  while true; do
    ask "$_var" "$_prompt" "$_def"
    _v="${!_var}"
    case "$_v" in
      ''|*[!0-9]*) ;;
      *) if [ "$_v" -ge "$_min" ] && [ "$_v" -le "$_max" ]; then return 0; fi ;;
    esac
    if [ -n "$INTERACTIVE" ]; then
      warn "请输入 ${_min}-${_max} 之间的数字"
      printf -v "$_var" ''
      continue
    fi
    err "请输入 ${_min}-${_max} 之间的数字（当前值：${_v}）"
  done
}

# ask_yes 变量名 提示语：回答 y/yes/1/true 置 1，其余置空
ask_yes() {
  local _var="$1" _prompt="$2" _v=""
  if [ -n "${!_var:-}" ]; then
    case "${!_var}" in
      [yY]|[yY][eE][sS]|1|true|TRUE) printf -v "$_var" '1' ;;
      *) printf -v "$_var" '' ;;
    esac
    return
  fi
  if read_line "$_prompt [y/N]: "; then _v="$_ANS"; fi
  case "${_v:-N}" in [yY]|[yY][eE][sS]|1|true|TRUE) printf -v "$_var" '1' ;; *) printf -v "$_var" '' ;; esac
}

gen_key() { openssl rand -hex 32 2>/dev/null || od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }

# ---------- 1) 安装目录 ----------
INSTALL_DIR="${IMAGEHUB_DIR:-}"
ask INSTALL_DIR "1/9 安装目录" "$HOME/ImageHub"
case "$INSTALL_DIR" in "~"*) INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}" ;; esac

# ---------- 2) 服务端口 ----------
ask_num PORT "2/9 服务端口" "$DEFAULT_PORT" 1 65535

# ---------- 3) 端口绑定地址 ----------
# 绑定地址决定暴露与否：Docker 发布端口不走系统防火墙（iptables DOCKER 链 / Docker Desktop 放行）
ask BIND_IP "3/9 端口绑定地址（127.0.0.1=仅本机，0.0.0.0=对外网开放）" "127.0.0.1"
case "$BIND_IP" in 127.0.0.1|0.0.0.0) ;; *) warn "非常规绑定地址：${BIND_IP}（一般填 127.0.0.1 或 0.0.0.0）" ;; esac

# ---------- 4) 站点对外访问地址 ----------
if [ -z "${SITE_URL:-}" ]; then
  PUB_IP="$(curl -4 -fsS --max-time 3 https://ifconfig.me 2>/dev/null || true)"
  if [ -n "$PUB_IP" ]; then SITE_URL="http://${PUB_IP}:${PORT}"; else SITE_URL="http://127.0.0.1:${PORT}"; fi
fi
ask SITE_URL "4/9 站点对外访问地址" "$SITE_URL"
case "$SITE_URL" in http://*|https://*) ;; *) SITE_URL="http://${SITE_URL}" ;; esac

# ---------- 5) 登录回调地址（AUTH_URL） ----------
# Auth.js 用它对外的协议与域名生成回调。反向代理若没传 X-Forwarded-Proto，
# 会按 http 生成回调，https 页面下点「登录」请求会被浏览器拦截（表现为没反应）。
# 留空 = 按请求头自动推断（本机 / 局域网直连最省事）；域名 + HTTPS 反代部署建议显式填写。
ask AUTH_URL "5/9 登录回调地址（HTTPS 反代部署填 https://你的域名；回车=自动推断）" ""
if [ -n "$AUTH_URL" ]; then
  case "$AUTH_URL" in http://*|https://*) ;; *) AUTH_URL="https://${AUTH_URL}" ;; esac
  AUTH_URL="${AUTH_URL%/}"
fi

# ---------- 6) 数据库密码 ----------
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  _p=""
  read_line "6/9 数据库密码（留空自动生成 64 位随机密码）: " secret && _p="$_ANS"
  POSTGRES_PASSWORD="${_p:-$(gen_key)}"
fi
[ "${#POSTGRES_PASSWORD}" -ge 8 ] || err "数据库密码至少 8 位"

# ---------- 7) 图片上传上限 ----------
ask_num MAX_UPLOAD_MB "7/9 图片单文件上传上限（MB）" "512" 1 512

# ---------- 8) 是否自动转 WebP ----------
ask_yes CONVERT_TO_WEBP "8/9 把 jpg/png 自动转成 WebP 存储（省空间，画质轻微变化）？"

# ---------- 9) Redis ----------
ask_yes REDIS_ENABLED "9/9 启用 Redis 缓存（多实例部署或需限流计数重启不丢失时建议启用）？"

# ---------- 生成会话密钥与首注册门控令牌（不询问，保证强度） ----------
AUTH_SECRET="$(gen_key)"
# 首注册门控令牌——空库状态下首次注册（将自动成为超级管理员）必须携带该令牌，
# 防止服务就绪到站长注册之间的窗口被公网陌生人抢注；脚本随后引导站长立即注册
SETUP_TOKEN="${SETUP_TOKEN:-$(gen_key)}"

log ""
log "──────── 安装配置确认 ────────"
log "安装目录　　：${INSTALL_DIR}"
log "端口绑定　　：${BIND_IP}:${PORT}（容器内 3000）"
log "站点地址　　：${SITE_URL}"
log "登录回调　　：$([ -n "$AUTH_URL" ] && echo "$AUTH_URL" || echo '自动推断（跟随访问地址）')"
log "数据库密码　：${POSTGRES_PASSWORD:0:4}********（已隐藏）"
log "上传上限　　：${MAX_UPLOAD_MB} MB（视频不设上限）"
log "WebP 转换　：$([ -n "$CONVERT_TO_WEBP" ] && echo '开启' || echo '关闭（保留原格式）')"
log "会话密钥　　：随机生成"
log "首注册门控　：已启用（启动后引导注册站长账号，第一个注册即超管）"
log "Redis 缓存　：$([ -n "$REDIS_ENABLED" ] && echo '启用' || echo '不启用（限流走进程内存）')"
log "──────────────────────────────"

# 最后确认：非交互场景直接继续，交互场景允许退回修改前的状态
if read_line "确认以上配置并开始安装？[Y/n]: "; then
  case "${_ANS:-Y}" in
    [nN]|[nN][oO]) log "已取消安装，未做任何改动"; exit 0 ;;
  esac
fi

# ---------- 写入 .env ----------
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ -f .env ]; then
  warn ".env 已存在，沿用现有配置（如需重置请删除 .env 后重跑）"
  # 老版本生成的 .env 没有 AUTH_URL：本次问答填了就补一行（留空则维持自动推断）
  if [ -n "$AUTH_URL" ] && ! grep -qE '^AUTH_URL=' .env; then
    printf 'AUTH_URL="%s"\n' "$AUTH_URL" >> .env
    log "已追加 AUTH_URL（${AUTH_URL}）"
  fi
  if [ -n "$REDIS_ENABLED" ] && ! grep -qE '^REDIS_URL=' .env; then
    printf 'REDIS_URL="redis://redis:6379"\n' >> .env
    log "已追加 REDIS_URL"
  fi
  # 重跑安装时沿用 .env 中的 SETUP_TOKEN（不轮换，保证手动注册指引可用）；
  # .env 无该行则追加，保证首注册门控始终生效
  if grep -qE '^SETUP_TOKEN=' .env; then
    SETUP_TOKEN="$(sed -nE 's/^SETUP_TOKEN="?([^"]*)"?$/\1/p' .env | tail -n1)"
  else
    printf 'SETUP_TOKEN="%s"\n' "$SETUP_TOKEN" >> .env
    log "已追加 SETUP_TOKEN（首注册门控）"
  fi
else
  {
    echo "SITE_URL=\"${SITE_URL}\""
    if [ -n "$AUTH_URL" ]; then echo "AUTH_URL=\"${AUTH_URL}\""; fi
    echo "AUTH_SECRET=\"${AUTH_SECRET}\""
    echo "PORT=\"${PORT}\""
    echo "BIND_IP=\"${BIND_IP}\""
    echo "POSTGRES_PASSWORD=\"${POSTGRES_PASSWORD}\""
    echo "SETUP_TOKEN=\"${SETUP_TOKEN}\""
    echo "MAX_UPLOAD_MB=\"${MAX_UPLOAD_MB}\""
    if [ -n "$CONVERT_TO_WEBP" ]; then
      echo "CONVERT_TO_WEBP=\"true\""
    else
      echo "CONVERT_TO_WEBP=\"false\""
    fi
    if [ -n "$REDIS_ENABLED" ]; then echo "REDIS_URL=\"redis://redis:6379\""; fi
  } > .env
  log ".env 已生成（AUTH_SECRET/SETUP_TOKEN 随机；数据库密码为自定义或随机值）"
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

# ---------- 7) 引导注册站长账号 ----------
# 服务就绪后立即引导站长注册，请求自动携带 SETUP_TOKEN；
# 第一个注册的账号即刻成为超级管理员，公网抢注窗口（服务就绪 → 站长注册）随之关闭
REG_DONE=""

# JSON 字符串转义（先反斜杠后双引号），用于拼接注册请求体
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# 注册失败/被跳过时的手动注册指引（密码规则与站点强密码校验一致：≥8 位且含大小写字母与数字）
print_manual_hint() {
  warn "手动注册方式（在服务器上执行，密码需至少 8 位且含大小写字母与数字）："
  warn "  curl -sS -X POST http://127.0.0.1:${PORT}/api/register -H 'Content-Type: application/json' \\"
  warn "       -d '{\"email\":\"you@example.com\",\"name\":\"yourname\",\"password\":\"Abcdef12\",\"setupToken\":\"${SETUP_TOKEN}\"}'"
  warn "返回 201 即成功，该账号自动成为超级管理员。"
  warn "（或删除 .env 中的 SETUP_TOKEN 行并 docker compose up -d 关闭门控后，在网页上注册第一个账号）"
}

register_owner() {
  log ""
  log "──────── 10/10 注册站长账号 ────────"
  log "第一个注册的账号将自动成为超级管理员（站长），建议现在完成注册。"
  _go=""
  read_line "现在注册站长账号？[Y/n]: " && _go="$_ANS"
  case "${_go:-Y}" in
    [nN]|[nN][oO]) warn "已跳过：稍后可按下方指引手动注册（首注册门控保持生效）"; print_manual_hint; return 0 ;;
  esac
  local _email _name _pw _pw2 _attempt
  for _attempt in 1 2 3; do
    _email=""; _name=""; _pw=""; _pw2=""
    read_line "邮箱: " && _email="$_ANS"
    read_line "用户名: " && _name="$_ANS"
    read_line "密码（至少 8 位，含大小写字母与数字）: " secret && _pw="$_ANS"
    read_line "再次输入密码: " secret && _pw2="$_ANS"
    if [ -z "$_email" ] || [ -z "$_name" ] || [ -z "$_pw" ]; then
      warn "邮箱/用户名/密码均不能为空，请重试（第 ${_attempt}/3 次）"; continue
    fi
    if [ "$_pw" != "$_pw2" ]; then
      warn "两次输入的密码不一致，请重试（第 ${_attempt}/3 次）"; continue
    fi
    local _body _resp _code _err
    _body="{\"email\":\"$(json_escape "$_email")\",\"name\":\"$(json_escape "$_name")\",\"password\":\"$(json_escape "$_pw")\",\"setupToken\":\"$(json_escape "$SETUP_TOKEN")\"}"
    _resp="$(curl -sS --max-time 15 -X POST "http://127.0.0.1:${PORT}/api/register" \
      -H 'Content-Type: application/json' -d "$_body" -w $'\n%{http_code}' || true)"
    _code="$(printf '%s' "$_resp" | tail -n1)"
    _err="$(printf '%s' "$_resp" | grep -oE '"error":"[^"]*"' | cut -d'"' -f4 || true)"
    if [ "$_code" = "201" ]; then
      REG_DONE=1
      log "站长账号注册成功：${_email}（已自动成为超级管理员）"
      return 0
    elif [ "$_code" = "409" ]; then
      warn "站点已有注册用户（${_err:-邮箱或用户名已被占用}），直接登录即可"
      return 0
    elif [ "$_code" = "403" ] && printf '%s' "$_err" | grep -q '关闭注册'; then
      warn "${_err}：请用现有账号登录"
      return 0
    else
      warn "注册失败（HTTP ${_code:-未知}）：${_err:-请检查网络或容器日志}（第 ${_attempt}/3 次）"
    fi
  done
  warn "连续 3 次注册失败，已跳过（首注册门控保持生效）"
  print_manual_hint
  return 0
}

if [ -n "$INTERACTIVE" ]; then
  register_owner
else
  warn "非交互安装：首注册门控（SETUP_TOKEN）已生效，空库首次注册需携带该令牌，防止公网抢注超管"
fi

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
if [ -n "$REG_DONE" ]; then
  log "站长账号已注册并自动成为超级管理员：打开站点登录即可"
  log "建议：到「站点设置」关闭开放注册"
else
  warn "站长账号尚未注册：注册第一个账号前首注册门控（SETUP_TOKEN）持续生效"
fi
log "管理：bash ${INSTALL_DIR}/manage.sh（19 项菜单：更新/备份/角色管理/定时备份/用户列表等）"
log "──────────────────────────────────────────────"
