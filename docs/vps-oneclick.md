# VPS 一键部署（HTTPS + 反代 + 基础防护）

适用场景：你要在 VPS 常驻运行 QQ 农场 Web 控制台（支持多账号）。

## 前置条件

1. Ubuntu 22.04 / 24.04（root 或 sudo）。
2. 域名已解析到 VPS（A 记录）。
3. 开放入站端口：22、80、443。

## 一键部署

在项目根目录执行：

```bash
sudo bash deploy/vps-oneclick.sh \
  --domain farm.example.com \
  --repo https://github.com/Cyrillico/qq-farm-bot.git \
  --branch main \
  --auth-user admin
```

脚本会自动：

- 安装 Node.js 20、Caddy、UFW、fail2ban、自动安全更新。
- 拉取代码到 `/opt/qq-farm-bot`。
- 写入 `.env`（含 Web 登录账号密码环境变量）。
- 创建并启动 `qq-farm-ui` systemd 服务。
- 配置 Caddy 反向代理到 `127.0.0.1:3210` 并自动签发 HTTPS 证书。
- 开启防火墙规则（OpenSSH/80/443）。

## 常用运维命令

```bash
# 查看服务状态
sudo systemctl status qq-farm-ui

# 重启服务
sudo systemctl restart qq-farm-ui

# 查看实时日志
sudo journalctl -u qq-farm-ui -f

# 查看 Caddy 状态
sudo systemctl status caddy
```

## 更新代码

```bash
sudo bash deploy/vps-oneclick.sh \
  --domain farm.example.com \
  --repo https://github.com/Cyrillico/qq-farm-bot.git \
  --branch main \
  --auth-user admin
```

说明：脚本会自动 `git fetch + reset --hard origin/<branch>`，确保部署目录与远端一致。

## 可选参数

- `--auth-pass <password>`：不想交互输入时可直接传（不推荐，可能进 shell history）。
- `--auth-secret <secret>`：自定义会话签名密钥。
- `--web-host <host>`：默认 `127.0.0.1`。
- `--web-port <port>`：默认 `3210`。
- `--skip-ufw`、`--skip-fail2ban`、`--skip-auto-updates`：跳过对应安全步骤。

## 安全建议

1. 必须启用 `WEB_UI_AUTH_USERNAME/WEB_UI_AUTH_PASSWORD`。
2. 使用强随机 `WEB_UI_AUTH_SECRET`。
3. 不要把 `.env`、`.qq-farm-ui-settings.json` 提交到仓库。
4. 建议关闭 VPS 的 root 密码登录，仅保留 SSH Key 登录。
