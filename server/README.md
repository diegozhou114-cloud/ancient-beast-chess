# Ancient Beast Chess Server

暗兽棋 v1.0.0 的权威联机服务器。服务器在内存中管理多个双人房间，使用现有 TypeScript 规则校验每一步，并通过 WebSocket 发送不泄露暗子身份的公开快照。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm ci
npm run dev
```

生产构建与启动：

```bash
npm run build
npm start
```

默认监听 `0.0.0.0:8787`：

- 状态页：`GET /`
- 健康检查：`GET /health`
- 服务器信息：`GET /info`
- WebSocket：`/ws`

在包发布后可直接运行：

```bash
npx --yes ancient-beast-chess-server@1.0.0
```

截至 2026-08-31，npm registry 查询 `ancient-beast-chess-server` 返回 `E404`，未发现已发布的同名包；这不构成包名预留。本仓库没有执行 npm 发布。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `ABC_HOST` | `0.0.0.0` | 监听地址 |
| `ABC_PORT` | `8787` | 监听端口 |
| `ABC_TRUST_PROXY` | `false` | 是否信任规范 `X-Forwarded-For` 首项；仅可在后端只接受可信代理连接时开启 |
| `ABC_WAITING_TIMEOUT_MS` | `600000` | 等待对手/准备的最长时间，默认 10 分钟 |
| `ABC_RECONNECT_GRACE_MS` | `300000` | 断线重连宽限，默认 5 分钟 |
| `ABC_ENDED_RETENTION_MS` | `120000` | 结束结果保留时间，默认 2 分钟 |
| `ABC_CLEANUP_INTERVAL_MS` | `1000` | 生命周期扫描间隔 |
| `ABC_HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket ping 间隔 |
| `ABC_MAX_MESSAGE_BYTES` | `16384` | 单条消息字节上限 |
| `ABC_MAX_CONNECTIONS` | `1000` | 同时 WebSocket 连接上限 |
| `ABC_MAX_ROOMS` | `500` | 内存房间上限 |
| `ABC_CONNECTIONS_PER_MINUTE` | `30` | 单 IP 每分钟连接尝试上限 |
| `ABC_ROOM_OPS_PER_MINUTE` | `20` | 单 IP 每分钟建房/加入/恢复上限 |
| `ABC_ACTIONS_PER_10_SECONDS` | `40` | 单连接每 10 秒行动上限 |

所有日志为单行 JSON。日志包含事件、房间码和连接 ID，但不会记录重连令牌或暗子身份。

## 重要限制

- v1.0.0 只使用进程内 `Map` 保存房间；服务器重启、进程崩溃或容器替换会丢失全部房间。
- 单进程可管理多个房间；不会为每个房间派生进程。
- 不包含账号、随机匹配、聊天、观战、排行榜、持久化或跨服务器发现；客户端联机 UI 位于仓库根项目，不打进服务器 npm 包。
- 反向代理必须支持 WebSocket upgrade；公网部署应使用 TLS，即 `wss://`。默认忽略客户端发送的 `X-Forwarded-For`。
- 只有在后端端口已绑定到回环地址或由防火墙限制为可信代理后，才能设置 `ABC_TRUST_PROXY=true`；代理必须覆盖而非追加客户端提供的 `X-Forwarded-For`。

完整消息格式见 [协议文档](docs/protocol-zh.md)，各 Linux 发行版安装方式见 [部署文档](docs/deployment-zh.md)。

通过 Release 包安装后，全局安装会同时提供更新命令。它先校验 Release 包的 SHA-256，再安装、重启已有 systemd 服务，并核对 `/health` 与 `/info` 报告的版本和协议：

```bash
ancient-beast-chess-server-update 1.0.0
```

同一版本需要重新安装修订包时使用 `ancient-beast-chess-server-update 1.0.0 --force`。更新脚本不修改防火墙；失败时会保留并打印上一版本的回滚命令。

## 验证

```bash
npm run typecheck
npm test
npm run build
node scripts/verify-package.mjs
```

## 许可

[MIT](LICENSE)
