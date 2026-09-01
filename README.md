# 暗兽棋 / Ancient Beast Chess

一个 4×5 的古版斗兽暗棋桌面游戏。你可选择朱方或墨方，与五档难度的 AI 对弈；每回合可翻一枚暗子或移动一枚己方明子。

## 单机挑战

- 五档 AI 难度由易到难依次为：蛊雕、朱厌、獓狠、相柳、穷奇。
- 开局前可选择朱方或墨方；朱方先行，因此选择墨方时由 AI 先行。
- 棋局开始后难度与阵营锁定，可重新开始当前配置，或返回选择界面重新设置。

## 玩法

- 双方各有：人、象、狮、虎、豹、豺、狼、狗、猫、鼠。
- 阶位高者可吃低者，同阶相遇则同归；鼠可吃象，象不能吃鼠。
- 狮可横竖走一步、斜走一步，或横竖跨过一格。
- 猫可上相邻暗子之墙，鼠可钻入相邻暗子之洞；狗也可“狗急跳墙”，并可吃相邻墙上的敌方猫。
- 被猫、狗或鼠叠放的暗子，在叠放棋子移开前无法翻开。

## 开发

```bash
npm install
npm run desktop
```

## 联机对战（v1.0.0）

仓库中的 `server/` 是独立的 TypeScript + Node.js 权威 WebSocket 服务器，直接复用并打包现有棋局规则。服务器负责真实暗子、洗牌、回合与行动校验，公开快照不会包含未翻棋子的阵营或类型。

macOS 与 Windows 桌面客户端可在“局域网”模式中直接成为房主。客户端会启动内嵌的单房权威服务器，并广播尚未坐满的房间；同网段桌面客户端可从房间列表加入，也可输入六位房间码加入。加入申请必须由房主同意，30 秒未处理会失效。浏览器不能监听本地端口或 UDP 广播，因此网页版本只提供公网或自建服务器模式。

```bash
npm ci --prefix server
npm run server:dev    # 开发监听
npm run server:test   # 服务器自动化测试
npm run server:build  # 生产构建
npm run server:start  # 启动已构建服务器
npm run server:pack:check         # 校验服务器 npm 包边界
npm run server:pack -- --dry-run  # 预览服务器 npm tgz
npm run server:pack               # 生成服务器 npm tgz
npm run test:lan:20               # 真实 UDP + WebSocket 局域网流程跑 20 盘
```

默认服务地址为 `http://0.0.0.0:8787`，WebSocket 路径为 `/ws`。Docker、自建安装、环境变量与 systemd 说明见 [服务器部署文档](server/docs/deployment-zh.md)，消息格式见 [WebSocket 协议](server/docs/protocol-zh.md)。

v1.0.0 使用单进程内存房间：一个进程可管理多个房间，但服务器重启会丢失全部房间。本版本不含账号、匹配队列、聊天、观战、排行榜或持久化。

客户端主页选择“联机对战”后，也可切换到“公网 / 自建”并填写任意允许连接的 `ws://` 或 `wss://` 服务器地址。双方加入并准备后自动开局。对局中任意一方可直接认输，由权威服务器判定对方获胜。客户端只保存当前浏览器会话所需的重连令牌；主动离房或对局结束后立即清除。

## 打包

```bash
npm run package:mac  # Apple Silicon macOS DMG
npm run package:win  # Windows x64 免安装 ZIP
```

安装包分别输出到 `release/macos/` 与 `release/windows/`，不会被后续前端构建清理。macOS 包为未签名的本地构建，首次打开可能需要在 Finder 中右键选择“打开”。

## 验证

```bash
npm test
npm run build
```

## 许可

[MIT](LICENSE)
