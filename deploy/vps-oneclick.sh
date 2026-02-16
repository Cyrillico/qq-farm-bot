#!/usr/bin/env bash
set -euo pipefail

APP_USER="qqfarm"
APP_GROUP="qqfarm"
APP_DIR="/opt/qq-farm-bot"
SERVICE_NAME="qq-farm-ui"
REPO_URL="https://github.com/Cyrillico/qq-farm-bot.git"
BRANCH="main"
DOMAIN=""
EMAIL=""
AUTH_USER=""
AUTH_PASS=""
AUTH_SECRET=""
NODE_MAJOR="20"
WEB_PORT="3210"
WEB_HOST="127.0.0.1"
ENABLE_UFW="1"
ENABLE_FAIL2BAN="1"
ENABLE_AUTO_UPDATES="1"

log() {
  printf "\n[%s] %s\n" "$(date '+%F %T')" "$*"
}

die() {
  echo "[ERROR] $*" >&2
  exit 1
}

usage() {
  cat <<USAGE
QQ 农场 VPS 一键部署脚本（Ubuntu 22.04/24.04）

用法:
  sudo bash deploy/vps-oneclick.sh --domain farm.example.com [options]

必填:
  --domain <domain>            公网域名（需提前解析到 VPS）

可选:
  --repo <url>                 Git 仓库地址（默认: ${REPO_URL}）
  --branch <name>              分支（默认: ${BRANCH}）
  --app-dir <path>             部署目录（默认: ${APP_DIR}）
  --app-user <user>            运行用户（默认: ${APP_USER}）
  --web-port <port>            Node 监听端口（默认: ${WEB_PORT}）
  --web-host <host>            Node 监听地址（默认: ${WEB_HOST}）
  --email <email>              TLS 证书通知邮箱（可选）

  --auth-user <username>       Web 控制台登录用户名
  --auth-pass <password>       Web 控制台登录密码
  --auth-secret <secret>       会话签名密钥（建议 32+ 随机字符）

  --skip-ufw                   跳过 UFW 防火墙配置
  --skip-fail2ban              跳过 fail2ban 配置
  --skip-auto-updates          跳过自动安全更新配置

示例:
  sudo bash deploy/vps-oneclick.sh \\
    --domain farm.example.com \\
    --auth-user admin
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        DOMAIN="${2:-}"
        shift 2
        ;;
      --repo)
        REPO_URL="${2:-}"
        shift 2
        ;;
      --branch)
        BRANCH="${2:-}"
        shift 2
        ;;
      --app-dir)
        APP_DIR="${2:-}"
        shift 2
        ;;
      --app-user)
        APP_USER="${2:-}"
        APP_GROUP="$APP_USER"
        shift 2
        ;;
      --web-port)
        WEB_PORT="${2:-}"
        shift 2
        ;;
      --web-host)
        WEB_HOST="${2:-}"
        shift 2
        ;;
      --email)
        EMAIL="${2:-}"
        shift 2
        ;;
      --auth-user)
        AUTH_USER="${2:-}"
        shift 2
        ;;
      --auth-pass)
        AUTH_PASS="${2:-}"
        shift 2
        ;;
      --auth-secret)
        AUTH_SECRET="${2:-}"
        shift 2
        ;;
      --skip-ufw)
        ENABLE_UFW="0"
        shift
        ;;
      --skip-fail2ban)
        ENABLE_FAIL2BAN="0"
        shift
        ;;
      --skip-auto-updates)
        ENABLE_AUTO_UPDATES="0"
        shift
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

ensure_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "请使用 root 或 sudo 运行"
  fi
}

prompt_secrets_if_needed() {
  if [[ -z "$AUTH_USER" ]]; then
    read -r -p "请输入 Web 控制台用户名 (WEB_UI_AUTH_USERNAME): " AUTH_USER
  fi

  if [[ -z "$AUTH_PASS" ]]; then
    read -r -s -p "请输入 Web 控制台密码 (WEB_UI_AUTH_PASSWORD): " AUTH_PASS
    echo
  fi

  if [[ -z "$AUTH_SECRET" ]]; then
    AUTH_SECRET="$(openssl rand -hex 32)"
  fi

  [[ -n "$AUTH_USER" ]] || die "用户名不能为空"
  [[ -n "$AUTH_PASS" ]] || die "密码不能为空"
  [[ ${#AUTH_SECRET} -ge 16 ]] || die "AUTH_SECRET 至少 16 字符"
}

install_base_packages() {
  log "安装基础依赖"
  apt-get update -y
  apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    ufw \
    fail2ban \
    unattended-upgrades \
    apt-transport-https \
    software-properties-common
}

install_node() {
  log "安装 Node.js ${NODE_MAJOR}.x"
  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "$current_major" == "$NODE_MAJOR" ]]; then
      log "Node.js 主版本已是 ${NODE_MAJOR}"
      return
    fi
  fi

  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

install_caddy() {
  log "安装 Caddy"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y caddy
  fi
}

prepare_user_and_dir() {
  log "准备运行用户与目录"
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi

  mkdir -p "$APP_DIR"
  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
}

deploy_code() {
  log "部署代码到 ${APP_DIR}"
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  else
    rm -rf "$APP_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

  log "安装 Node 依赖"
  runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" install --omit=dev
}

write_env_file() {
  log "写入应用环境变量"
  local esc_user esc_pass esc_secret
  esc_user="$(printf '%s' "$AUTH_USER" | sed 's/\\/\\\\/g; s/\"/\\"/g')"
  esc_pass="$(printf '%s' "$AUTH_PASS" | sed 's/\\/\\\\/g; s/\"/\\"/g')"
  esc_secret="$(printf '%s' "$AUTH_SECRET" | sed 's/\\/\\\\/g; s/\"/\\"/g')"
  cat >"$APP_DIR/.env" <<ENV
NODE_ENV=production
WEB_UI_HOST=${WEB_HOST}
WEB_UI_PORT=${WEB_PORT}
WEB_UI_AUTH_USERNAME="${esc_user}"
WEB_UI_AUTH_PASSWORD="${esc_pass}"
WEB_UI_AUTH_SECRET="${esc_secret}"
ENV

  chown "$APP_USER:$APP_GROUP" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
}

write_systemd_service() {
  log "配置 systemd 服务: ${SERVICE_NAME}"
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=QQ Farm Web UI Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/web-ui.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${APP_DIR} /tmp
CapabilityBoundingSet=
AmbientCapabilities=
UMask=027
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
}

write_caddyfile() {
  log "配置 Caddy HTTPS 反向代理"

  local caddy_global=""
  if [[ -n "$EMAIL" ]]; then
    caddy_global="{
    email ${EMAIL}
}
"
  fi

  cat > /etc/caddy/Caddyfile <<CADDY
${caddy_global}${DOMAIN} {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    reverse_proxy 127.0.0.1:${WEB_PORT}
}
CADDY

  caddy fmt --overwrite /etc/caddy/Caddyfile
  systemctl enable --now caddy
  systemctl reload caddy || systemctl restart caddy
}

configure_ufw() {
  if [[ "$ENABLE_UFW" != "1" ]]; then
    log "跳过 UFW 配置"
    return
  fi

  log "配置 UFW 防火墙"
  ufw allow OpenSSH >/dev/null || true
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  ufw --force enable
}

configure_fail2ban() {
  if [[ "$ENABLE_FAIL2BAN" != "1" ]]; then
    log "跳过 fail2ban 配置"
    return
  fi

  log "配置 fail2ban（SSH 防暴力破解）"
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/sshd.local <<JAIL
[sshd]
enabled = true
port = ssh
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
JAIL

  systemctl enable --now fail2ban
  systemctl restart fail2ban
}

configure_auto_updates() {
  if [[ "$ENABLE_AUTO_UPDATES" != "1" ]]; then
    log "跳过自动更新配置"
    return
  fi

  log "启用安全自动更新"
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<AUTO
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AUTO

  systemctl enable --now unattended-upgrades || true
}

preflight_checks() {
  [[ -n "$DOMAIN" ]] || die "必须提供 --domain"

  if ! [[ "$WEB_PORT" =~ ^[0-9]+$ ]]; then
    die "--web-port 必须是数字"
  fi

  if [[ -z "$EMAIL" ]]; then
    EMAIL="admin@${DOMAIN}"
  fi
}

main() {
  parse_args "$@"
  ensure_root
  preflight_checks
  prompt_secrets_if_needed

  install_base_packages
  install_node
  install_caddy
  prepare_user_and_dir
  deploy_code
  write_env_file
  write_systemd_service
  write_caddyfile
  configure_ufw
  configure_fail2ban
  configure_auto_updates

  log "部署完成"
  echo "访问地址: https://${DOMAIN}"
  echo "Web 控制台用户名: ${AUTH_USER}"
  echo "Web 控制台密码: （你在部署时输入的值）"
  echo "systemd 服务: ${SERVICE_NAME}"
  echo "更新命令: sudo bash deploy/vps-oneclick.sh --domain ${DOMAIN} --repo ${REPO_URL} --branch ${BRANCH} --auth-user ${AUTH_USER}"
}

main "$@"
