# Linux 自建部署

目标支持 Ubuntu 22.04/24.04、Debian 12，以及 Rocky Linux 9、AlmaLinux 9、CentOS Stream 9 的 x64/arm64 环境。Node.js 最低版本为 20。CentOS 7 已结束常规生命周期且系统库过旧，本项目不承诺支持。

v1.0.0 使用内存房间，服务重启会丢失所有正在等待、进行中和已结束但尚未清理的房间。不要配置多个无共享状态的副本来承接同一个房间；本版本没有跨服务器发现或会话迁移。

## 方式一：Docker Compose

这是当前源码仓库最直接的部署方式：

```bash
git clone https://github.com/diegozhou114-cloud/ancient-beast-chess.git
cd ancient-beast-chess
docker compose -f server/docker-compose.yml up -d --build
curl http://127.0.0.1:8787/health
```

查看结构化日志：

```bash
docker compose -f server/docker-compose.yml logs -f
```

改变公开端口或生命周期：

```bash
ABC_PUBLIC_PORT=9876 \
ABC_BIND_ADDRESS=127.0.0.1 \
ABC_TRUST_PROXY=true \
ABC_WAITING_TIMEOUT_MS=600000 \
ABC_RECONNECT_GRACE_MS=300000 \
ABC_ENDED_RETENTION_MS=120000 \
docker compose -f server/docker-compose.yml up -d
```

`ABC_BIND_ADDRESS=127.0.0.1` 使宿主机端口只接受本机反向代理连接；只有这种受限部署才应开启 `ABC_TRUST_PROXY=true`。容器以非 root 用户运行，根文件系统只读，并移除 Linux capabilities。房间完全位于内存，不需要挂载数据卷。

## 方式二：从源码运行

### Ubuntu 22.04/24.04 与 Debian 12

安装 Node.js 20 和基础工具：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

### Rocky/Alma/CentOS Stream 9

```bash
sudo dnf install -y ca-certificates curl git
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node --version
```

### 构建并启动

```bash
git clone https://github.com/diegozhou114-cloud/ancient-beast-chess.git
cd ancient-beast-chess
npm ci --prefix server
npm run server:test
npm run server:build
ABC_HOST=0.0.0.0 ABC_PORT=8787 npm run server:start
```

生产环境可为最后一条命令配置 systemd。示例 `/etc/systemd/system/ancient-beast-chess-server.service`：

```ini
[Unit]
Description=Ancient Beast Chess Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=abc-server
WorkingDirectory=/opt/ancient-beast-chess/server
Environment=NODE_ENV=production
Environment=ABC_HOST=0.0.0.0
Environment=ABC_PORT=8787
ExecStart=/usr/bin/node /opt/ancient-beast-chess/server/dist/cli.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

实际路径和专用用户应按安装位置调整。修改后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ancient-beast-chess-server
sudo systemctl status ancient-beast-chess-server
```

## 方式三：Release 安装脚本

`install-server.sh` 面向 `server-v1.0.0` GitHub Release。服务器是架构无关的纯 JavaScript 包；脚本仍会检查系统为 Linux x64/arm64，但两种架构都下载真实 npm pack 产物 `ancient-beast-chess-server-1.0.0.tgz` 及 `ancient-beast-chess-server-1.0.0.tgz.sha256`，校验 SHA-256 后才执行全局 npm 安装：

```bash
bash server/install-server.sh
```

对应制品发布前脚本会明确下载失败。脚本不会绕过校验，也不会静默修改系统防火墙或云安全组。

已有全局安装可用明确目标版本进行更新；脚本会识别同名 systemd 服务，重启后同时检查 `/health` 与 `/info`，并打印上一版本的回滚命令：

```bash
bash server/update-server.sh 1.0.0
```

自定义服务名或本地健康检查地址时，可设置 `ABC_SERVER_SERVICE` 与 `ABC_SERVER_HEALTH_URL`。更新脚本不会从“latest”接口猜测版本，也不会创建 systemd 服务。

包发布后也可使用 npm registry：

```bash
npx --yes ancient-beast-chess-server@1.0.0
```

## 网络与 TLS

服务提供：

- `GET /health`
- `GET /info`
- `GET /`
- WebSocket `/ws`

安装脚本不会修改 `ufw`、`firewalld`、iptables、云安全组或负载均衡器。若确需公网直连，管理员必须显式开放所选 TCP 端口，并同时检查云厂商安全组。更推荐只让反向代理访问 8787，在 Nginx/Caddy/Traefik 终止 TLS。

服务器默认 `ABC_TRUST_PROXY=false`，会忽略所有客户端提供的 `X-Forwarded-For`，使用 TCP 对端地址限流。启用 `ABC_TRUST_PROXY=true` 后，服务器只在首个 XFF 值为规范 IPv4/IPv6 时使用它；无效或缺失时回退到 TCP 对端地址。启用前必须同时满足：

- 后端 8787 端口绑定到 `127.0.0.1`、私有容器网络，或由防火墙/安全组限制为仅可信代理可访问。
- 代理覆盖客户端传入的 XFF，而不是把不可信值追加到列表。

Caddy 示例：

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Forwarded-For {remote_host}
    }
}
```

Nginx 示例，其中 `$remote_addr` 会覆盖客户端自带的 XFF：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name game.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

公网客户端应使用 `wss://`。不要通过未加密公网连接发送房间码和重连令牌。

## 运维检查

```bash
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8787/info
```

`/info` 返回服务器/协议版本、在线玩家数、连接数、房间数、内存存储标记和容量上限，不返回房间码、棋盘或令牌。日志为 JSON 行，可由 journald 或容器日志收集器直接采集。
