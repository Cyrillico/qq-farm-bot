#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/qq-farm-bot"
SERVICE_NAME="qq-farm-ui"
BRANCH="main"
APP_USER=""

log() {
  printf "\n[%s] %s\n" "$(date '+%F %T')" "$*"
}

die() {
  echo "[ERROR] $*" >&2
  exit 1
}

usage() {
  cat <<USAGE
QQ 农场 VPS 一键更新脚本

用法:
  sudo bash deploy/vps-update.sh [options]

可选:
  --app-dir <path>            部署目录（默认: ${APP_DIR}）
  --service <name>            systemd 服务名（默认: ${SERVICE_NAME}）
  --branch <name>             更新分支（默认: ${BRANCH}）
  --app-user <user>           指定安装依赖时使用的用户
  --help, -h                  显示帮助

示例:
  sudo bash deploy/vps-update.sh
  sudo bash deploy/vps-update.sh --app-dir /opt/qq-farm-bot --service qq-farm-ui --branch main
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir)
        APP_DIR="${2:-}"
        shift 2
        ;;
      --service)
        SERVICE_NAME="${2:-}"
        shift 2
        ;;
      --branch)
        BRANCH="${2:-}"
        shift 2
        ;;
      --app-user)
        APP_USER="${2:-}"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "未知参数: $1"
        ;;
    esac
  done
}

ensure_requirements() {
  command -v git >/dev/null 2>&1 || die "缺少 git"
  command -v npm >/dev/null 2>&1 || die "缺少 npm"
  command -v systemctl >/dev/null 2>&1 || die "缺少 systemctl"
  [[ -d "$APP_DIR/.git" ]] || die "未找到 Git 部署目录: $APP_DIR"
  systemctl status "$SERVICE_NAME" >/dev/null 2>&1 || die "systemd 服务不存在: $SERVICE_NAME"
}

pick_app_user() {
  if [[ -n "$APP_USER" ]]; then
    return
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    APP_USER="$(stat -c '%U' "$APP_DIR")"
  else
    APP_USER="$(id -un)"
  fi
  [[ -n "$APP_USER" ]] || die "无法确定应用用户"
}

run_in_app_context() {
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u "$APP_USER" -- "$@"
  else
    "$@"
  fi
}

update_repo() {
  log "拉取最新代码"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
}

install_deps() {
  log "安装生产依赖"
  run_in_app_context npm --prefix "$APP_DIR" install --omit=dev
}

restart_service() {
  log "重启服务 ${SERVICE_NAME}"
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart "$SERVICE_NAME"
  else
    sudo systemctl restart "$SERVICE_NAME"
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,12p'
  else
    sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,12p'
  fi
}

main() {
  parse_args "$@"
  ensure_requirements
  pick_app_user
  log "更新目录: ${APP_DIR}"
  log "目标分支: origin/${BRANCH}"
  log "运行用户: ${APP_USER}"
  update_repo
  install_deps
  restart_service
  log "更新完成"
}

main "$@"
