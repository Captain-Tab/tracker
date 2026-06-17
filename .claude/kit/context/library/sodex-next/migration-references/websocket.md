# WebSocket 管理（sodex-next 参考）

> 来源：sodex-next/docs/websocket.md
> 用途：migration execute 阶段，迁移涉及实时数据功能时参考

## WsManager Class

纯 class，不依赖 React。负责连接/心跳/重连/订阅管理。

```ts
// shared/infra/wsManager.ts
export class WsManager {
  private connections = new Map<TransportScope, WebSocket>()
  private listeners = new Map<string, Set<(data: unknown) => void>>()
  connect(scope, url): void
  disconnect(scope): void
  subscribe(scope, topic, cb): void
  unsubscribe(scope, topic, cb): void
}
```

## 五个 Scope

| scope | WS 路径 | 数据类型 | 认证 | 连接时机 |
|---|---|---|---|---|
| spot_symbol | /ws/socket | qDeal, qDepth, qAllDepth | 无 | 进入现货交易页 |
| spot_market | /ws/socket | qStats, qKLine | 无 | 进入现货交易页 |
| futures_market | /ws/market | 合约行情 | 无 | 进入合约交易页 |
| spot_user | /ws/socket | 用户现货数据推送 | WS token | 登录+现货页 |
| futures_user | /ws/user | 用户合约数据推送 | listenKey | 登录+合约页 |

另有 1 条独立 explorer WS（不纳入 WsManager）：充提通知。

## Stream Service 关键机制

- **引用计数 + 延迟清理**：多组件共享数据流，最后卸载后等 5 秒再清理
- **频率控制**：throttle 限制写 Zustand 频率（≤ 10/sec）
- **竞态保护**：symbol 切换时 AbortController 取消旧请求
- **Gap 检测 + Resync**：delta sequence 不连续时重新拉取 snapshot

## WS 运维规范

| 参数 | 值 |
|---|---|
| 心跳间隔 | 15s |
| 心跳超时 | 5s |
| 重连策略 | exponential backoff 1s→2s→4s→8s→max 30s |
| 重连 jitter | ±20% |
| 最大重连次数 | 无限（10 次连续失败后 emit fatal） |
| 数据过期容忍 | 30s |
| 页面可见性 | 隐藏时暂停 resync，恢复时立即 resync |
| AbortError | 静默忽略 |
