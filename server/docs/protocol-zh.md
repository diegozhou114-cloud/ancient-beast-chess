# WebSocket 协议 v1

协议标识为 `abc-ws/1`，服务器版本为 `0.0.3`。客户端连接 `/ws`，只发送 UTF-8 JSON 文本消息。二进制消息会被拒绝，单条消息默认不得超过 16 KiB。

## 连接与房间流程

服务器建立连接后先发送：

```json
{"type":"welcome","protocolVersion":"abc-ws/1","serverVersion":"0.0.3","connectionId":"..."}
```

客户端消息：

| `type` | 字段 | 说明 |
|---|---|---|
| `create_room` | `requestId?` | 创建房间并占据朱方席位 |
| `join_room` | `roomCode`, `requestId?` | 加入房间的空席位 |
| `resume` | `roomCode`, `reconnectToken`, `requestId?` | 断线后恢复原席位 |
| `ready` | `ready`, `requestId?` | 设置准备状态；两席均准备后自动开局 |
| `action` | `version`, `action`, `requestId?` | 按指定公开版本执行行动 |
| `resign` | `requestId?` | 当前对局主动认输 |
| `leave_room` | `requestId?` | 开局前主动离开并立即释放席位 |

`action` 只能是：

```json
{"type":"flip","at":0}
```

或：

```json
{"type":"move","from":0,"to":1}
```

索引范围为 0 到 19。所有消息对象均为严格结构，多余字段也会返回 `INVALID_MESSAGE`。

创建、加入或恢复成功时，服务器发送：

```json
{
  "type": "room_joined",
  "roomCode": "ABC234",
  "seat": "red",
  "reconnectToken": "43-character-base64url-token",
  "snapshot": {}
}
```

重连令牌由 32 个加密随机字节生成，只在对应连接成功进入席位时发送。客户端应按敏感凭据保存，断线后建立新连接并发送 `resume`。其他玩家的快照、HTTP 接口和日志均不包含令牌。新连接恢复成功后会替换该席位的旧连接。

## 公开快照

每次公开状态变化都会递增 `version` 并广播 `snapshot`：

```json
{
  "type": "snapshot",
  "snapshot": {
    "roomCode": "ABC234",
    "version": 5,
    "phase": "playing",
    "createdAt": 1800000000000,
    "startedAt": 1800000001000,
    "endedAt": null,
    "seats": {
      "red": {"occupied":true,"ready":true,"connected":true,"reconnectDeadlineAt":null},
      "black": {"occupied":true,"ready":true,"connected":true,"reconnectDeadlineAt":null}
    },
    "game": {},
    "outcome": null
  }
}
```

`phase` 为 `waiting`、`playing` 或 `ended`。`game` 在开局前为 `null`；开局后包含棋盘、当前阵营、棋局状态、回合数、已阵亡棋子、公开日志和最后行动。

暗子只能表示为：

```json
{"revealed":false}
```

该对象绝不含 `id`、`camp` 或 `rank`。明子和叠放的公开棋子表示为：

```json
{"revealed":true,"camp":"red","rank":"lion"}
```

客户端必须以最新快照的 `version` 提交行动。版本不一致返回 `STALE_VERSION`，服务器不会执行行动。服务器还会依次校验房间阶段、行动方阵营和现有规则；越权、非当前回合及非法行动不会改变版本或状态。

对局结束时 `outcome.reason` 为 `game`、`draw`、`resigned`、`disconnect_timeout` 或 `abandoned`，`winner` 为 `red`、`black` 或 `null`。

## 错误与关闭

错误统一为：

```json
{"type":"error","requestId":"optional-correlation-id","code":"STALE_VERSION","message":"..."}
```

稳定错误码：

- `INVALID_MESSAGE`, `RATE_LIMITED`, `SERVER_FULL`, `ROOM_LIMIT_REACHED`
- `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_NOT_JOINABLE`, `ALREADY_IN_ROOM`
- `NOT_IN_ROOM`, `NOT_READYABLE`, `NOT_PLAYING`, `OUT_OF_TURN`
- `STALE_VERSION`, `ILLEGAL_ACTION`, `INVALID_RECONNECT_TOKEN`, `ROOM_EXPIRED`, `INTERNAL_ERROR`

房间因等待超时、结果保留到期或空房清理时发送：

```json
{"type":"room_closed","roomCode":"ABC234","reason":"retention_expired"}
```

## 生命周期

- 房间从创建起等待对手和准备，默认最多 10 分钟。
- 席位断线后保留强随机令牌和席位，默认宽限 5 分钟。
- 对局中只有一方断线且超过宽限时，连接中的一方获胜；双方均断线并超过宽限时记为 `abandoned`。
- 对局结束后默认保留结果 2 分钟，然后删除房间。
- WebSocket 使用 ping/pong 心跳；未响应的连接会被终止并进入相同断线流程。
