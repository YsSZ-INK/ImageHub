#!/usr/bin/env bash
# ============================================================
# ImageHub 站点管理脚本
#
# 用法（在安装目录内执行）：
#   bash manage.sh          # 进入交互菜单
#   bash manage.sh update   # 直接执行子命令（可省略菜单）
#
# 子命令：update | uninstall | port | password | admin | service
#         | logs | backup | restore | expose | cleanup | info
# ============================================================
set -euo pipefail

log()  { printf '\033[1;32m[ImageHub]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[提示]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 环境 ----------
SUDO=""
if [ "$(id -u)" != "0" ]; then
  docker info >/dev/null 2>&1 || SUDO="sudo"
fi
command -v docker >/dev/null 2>&1 || err "未检测到 docker，请先安装 Docker"

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"
[ -f docker-compose.yml ] || err "请在 ImageHub 安装目录内运行（未找到 docker-compose.yml）"
[ -f .env ] || err "缺少 .env，请先运行 install.sh 完成安装"

get_env() { grep -E "^${1}=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true; }
PORT="$(get_env PORT)";      PORT="${PORT:-3000}"
SITE_URL="$(get_env SITE_URL)"
BIND_IP="$(get_env BIND_IP)"; BIND_IP="${BIND_IP:-127.0.0.1}"
BACKUP_DIR="$INSTALL_DIR/backups"
mkdir -p "$BACKUP_DIR"

dc() { ${SUDO} docker compose "$@"; }

# 等待健康检查就绪（参数：端口）
wait_health() {
  local p="$1"
  for _ in $(seq 1 30); do
    curl -fsS --max-time 2 "http://127.0.0.1:${p}/api/health" 2>/dev/null | grep -q '"ok":true' && return 0
    sleep 2
  done
  return 1
}

# web 容器挂载的存储卷名（动态获取，避免项目名不一致）
storage_volume() {
  dc ps -q web >/dev/null 2>&1 || return 1
  ${SUDO} docker inspect "$(dc ps -q web)" --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' | head -n1
}

confirm() { # confirm 提示语 [默认no]
  local ans=""
  read -rp "$1 [y/N]: " ans || ans=""
  case "${ans:-N}" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# ---------- 1. 更新 ----------
do_update() {
  log "拉取最新镜像 …"
  dc pull web
  log "重启服务 …"
  dc up -d
  log "清理旧版本悬空镜像 …"
  ${SUDO} docker image prune -f
  log "等待服务就绪 …"
  if wait_health "$PORT"; then
    log "更新完成：http://127.0.0.1:${PORT}"
  else
    warn "健康检查超时，请执行 bash manage.sh logs 查看日志"
  fi
}

# ---------- 2. 卸载 ----------
do_uninstall() {
  warn "卸载将永久删除：容器、镜像、数据库（用户/图片记录）与全部图片文件，不可恢复！"
  confirm "确认彻底卸载 ImageHub？" || { log "已取消"; return; }
  read -rp "再次输入 YES 确认：" ans || ans=""
  [ "$ans" = "YES" ] || { log "已取消"; return; }
  dc down -v --rmi all
  if confirm "同时删除安装目录（$INSTALL_DIR，含 backups/ 备份文件）？"; then
    cd /
    rm -rf "$INSTALL_DIR"
    log "已删除安装目录"
  else
    log "安装目录已保留（backups/ 中的备份仍可用）"
  fi
  log "卸载完成"
}

# ---------- 3. 更改端口 ----------
do_port() {
  echo "当前端口：${PORT}（绑定地址 ${BIND_IP}）"
  read -rp "请输入新端口 [3000-65535]：" np || np=""
  case "$np" in ''|*[!0-9]*) err "端口必须是数字" ;; esac
  [ "$np" -ge 3000 ] && [ "$np" -le 65535 ] || err "端口需在 3000-65535 之间"
  sed -i.bak "s/^PORT=.*/PORT=\"${np}\"/" .env && rm -f .env.bak
  # SITE_URL 若带旧端口则同步替换
  if [ -n "$SITE_URL" ] && printf '%s' "$SITE_URL" | grep -q ":${PORT}$"; then
    sed -i.bak "s|:${PORT}$|:${np}|" .env && rm -f .env.bak
    log "SITE_URL 已同步为 $(grep -E '^SITE_URL=' .env)"
  fi
  log "应用新端口（重建 web 容器）…"
  dc up -d
  if wait_health "$np"; then
    log "端口已改为 ${np}：$(printf '%s' "$SITE_URL" | sed "s/:${PORT}$/:${np}/")"
  else
    warn "健康检查超时，请查看日志：bash manage.sh logs"
  fi
}

# ---------- 4. 重置密码 ----------
do_password() {
  read -rp "要重置密码的用户邮箱：" email || email=""
  [ -n "$email" ] || err "邮箱不能为空"
  email="${email//\'/}"
  read -rp "新密码（直接回车自动生成 12 位随机密码）：" -s npass || npass=""
  echo
  if [ -z "$npass" ]; then
    npass="$(head -c 16 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)"
    log "已生成随机密码"
  fi
  [ "${#npass}" -ge 8 ] || err "密码至少 8 位"
  log "生成密码哈希 …"
  HASH="$(dc exec -T web node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "$npass")"
  dc exec -T postgres psql -U imagehub -d imagehub -c "UPDATE \"User\" SET \"passwordHash\" = '${HASH}' WHERE email = '${email}';" \
    && log "密码已重置：${email} 新密码：${npass}" \
    || err "重置失败，请检查邮箱是否存在（区分大小写）"
}

# ---------- 5. 管理员设置 ----------
do_admin() {
  read -rp "用户邮箱：" email || email=""
  email="${email//\'/}"
  [ -n "$email" ] || err "邮箱不能为空"
  echo "1) 设为管理员  2) 取消管理员"
  read -rp "选择 [1-2]：" c || c=""
  case "$c" in
    1) ROLE="ADMIN" ;;
    2) ROLE="USER" ;;
    *) err "无效选择" ;;
  esac
  dc exec -T postgres psql -U imagehub -d imagehub -c "UPDATE \"User\" SET role = '${ROLE}' WHERE email = '${email}';" \
    && log "已将 ${email} 设为 ${ROLE}" \
    || err "操作失败，请检查邮箱是否存在"
}

# ---------- 6. 服务控制 ----------
do_service() {
  echo "1) 启动  2) 停止  3) 重启"
  read -rp "选择 [1-3]：" c || c=""
  case "$c" in
    1) dc up -d; log "已启动" ;;
    2) dc stop;  log "已停止（数据保留）" ;;
    3) dc restart; log "已重启" ;;
    *) err "无效选择" ;;
  esac
}

# ---------- 7. 日志 ----------
do_logs() {
  dc logs -f web --tail 100
}

# ---------- 8. 备份 ----------
do_backup() {
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  log "导出数据库 …"
  dc exec -T postgres pg_dump -U imagehub imagehub | gzip > "$BACKUP_DIR/db-${ts}.sql.gz"
  log "打包存储文件（图片/视频）…"
  local vol; vol="$(storage_volume)" || err "web 容器未运行，无法定位存储卷"
  ${SUDO} docker run --rm -v "${vol}":/data -v "$BACKUP_DIR":/backup alpine \
    tar czf "/backup/storage-${ts}.tar.gz" -C /data .
  log "备份完成（$BACKUP_DIR）："
  ls -lh "$BACKUP_DIR" | grep "$ts" || true
  warn "建议同时把备份文件下载到本机保存"
}

# ---------- 9. 还原 ----------
do_restore() {
  [ -d "$BACKUP_DIR" ] && ls "$BACKUP_DIR"/db-*.sql.gz >/dev/null 2>&1 || err "backups/ 中没有本脚本生成的备份"
  echo "可用备份（按时间倒序）："
  local i=1 files=()
  while IFS= read -r f; do files+=("$f"); echo "  $i) $(basename "$f")"; i=$((i+1)); done \
    < <(ls -1t "$BACKUP_DIR"/db-*.sql.gz)
  read -rp "选择要还原的备份序号：" n || n=""
  case "$n" in ''|*[!0-9]*) err "无效序号" ;; esac
  [ "$n" -ge 1 ] && [ "$n" -le "${#files[@]}" ] || err "无效序号"
  local dbf="${files[$((n-1))]}"
  local ts; ts="$(basename "$dbf" | sed 's/^db-//; s/\.sql\.gz$//')"
  local stf="$BACKUP_DIR/storage-${ts}.tar.gz"
  [ -f "$stf" ] || err "缺少配套的存储备份：storage-${ts}.tar.gz"
  warn "还原将把站点数据回滚到备份时刻，当前全部数据会被覆盖！"
  confirm "确认还原 $(basename "$dbf")？" || { log "已取消"; return; }
  log "停止 web 容器 …"
  dc stop web
  log "重建数据库 …"
  dc exec -T postgres psql -U imagehub -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='imagehub' AND pid <> pg_backend_pid();" \
    -c "DROP DATABASE IF EXISTS imagehub;" \
    -c "CREATE DATABASE imagehub OWNER imagehub;"
  gunzip -c "$dbf" | dc exec -T postgres psql -U imagehub -d imagehub -q
  log "还原存储文件 …"
  local vol; vol="$(storage_volume)" || err "无法定位存储卷（web 容器停止状态）"
  ${SUDO} docker run --rm -v "${vol}":/data -v "$BACKUP_DIR":/backup alpine \
    sh -c "find /data -mindepth 1 -delete && tar xzf /backup/$(basename "$stf") -C /data"
  log "启动服务 …"
  dc up -d
  if wait_health "$PORT"; then log "还原完成：http://127.0.0.1:${PORT}"; else warn "健康检查超时，请查看日志"; fi
}

# ---------- 10. 对外开放 / 仅本机 ----------
do_expose() {
  echo "当前绑定地址：${BIND_IP}"
  echo "1) 仅本机可访问（127.0.0.1，推荐配合反向代理）"
  echo "2) 对外网开放（0.0.0.0，所有网卡可直接访问，建议配合防火墙限源）"
  read -rp "选择 [1-2]：" c || c=""
  case "$c" in
    1) NEW="127.0.0.1" ;;
    2) NEW="0.0.0.0"; warn "开放后端口将直接暴露在公网" ;;
    *) err "无效选择" ;;
  esac
  sed -i.bak "s/^BIND_IP=.*/BIND_IP=\"${NEW}\"/" .env && rm -f .env.bak
  grep -qE '^BIND_IP=' .env || printf 'BIND_IP="%s"\n' "$NEW" >> .env
  dc up -d
  log "已应用：绑定地址 ${NEW}"
}

# ---------- 11. 清理 ----------
do_cleanup() {
  log "清理悬空镜像 …"
  ${SUDO} docker image prune -f
  log "当前 Docker 磁盘占用："
  ${SUDO} docker system df
}

# ---------- 12. 站点信息 ----------
do_info() {
  echo "──────────── ImageHub 站点信息 ────────────"
  echo "  安装目录：$INSTALL_DIR"
  echo "  访问地址：${SITE_URL:-（未配置）}"
  echo "  端口绑定：${BIND_IP}:${PORT} → 容器 3000"
  echo "  绑定含义：127.0.0.1=仅本机（外网打不开） / 0.0.0.0=对外网开放"
  echo "  备份目录：$BACKUP_DIR"
  echo "  容器状态："
  dc ps
  local vol; vol="$(storage_volume)" || vol=""
  if [ -n "$vol" ]; then
    echo "  存储占用："
    ${SUDO} docker run --rm -v "${vol}":/data alpine du -sh /data 2>/dev/null | awk '{print "    图片/视频：" $1}'
  fi
  echo "────────────────────────────────────────────"
}

# ---------- 菜单 ----------
menu() {
  while true; do
    echo ""
    echo "══════════ ImageHub 管理菜单 ══════════"
    echo "  1) 更新并清理旧镜像"
    echo "  2) 卸载（删除全部数据）"
    echo "  3) 更改端口"
    echo "  4) 重置用户密码"
    echo "  5) 设为 / 取消管理员"
    echo "  6) 服务 启动 / 停止 / 重启"
    echo "  7) 查看实时日志"
    echo "  8) 备份数据（数据库 + 图片）"
    echo "  9) 还原数据（从备份）"
    echo " 10) 端口对外开放 / 仅本机 切换"
    echo " 11) 清理悬空镜像与查看磁盘占用"
    echo " 12) 站点信息"
    echo "  0) 退出"
    read -rp "请选择 [0-12]：" c || exit 0
    case "$c" in
      1) do_update ;;
      2) do_uninstall ;;
      3) do_port ;;
      4) do_password ;;
      5) do_admin ;;
      6) do_service ;;
      7) do_logs ;;
      8) do_backup ;;
      9) do_restore ;;
      10) do_expose ;;
      11) do_cleanup ;;
      12) do_info ;;
      0|"") exit 0 ;;
      *) warn "无效选择" ;;
    esac
  done
}

# 支持子命令直达：bash manage.sh update
case "${1:-}" in
  update) do_update ;;
  uninstall) do_uninstall ;;
  port) do_port ;;
  password) do_password ;;
  admin) do_admin ;;
  service) do_service ;;
  logs) do_logs ;;
  backup) do_backup ;;
  restore) do_restore ;;
  expose) do_expose ;;
  cleanup) do_cleanup ;;
  info) do_info ;;
  "") menu ;;
  *) err "未知命令：$1（可用：update/uninstall/port/password/admin/service/logs/backup/restore/expose/cleanup/info）" ;;
esac
