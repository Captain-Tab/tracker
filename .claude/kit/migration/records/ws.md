# ws

跨迁移的 **WebSocket 推送机制** 类坑。

---

## ws:callForPermit-push-deferred

- **tags**: ws, callForPermit, sodex_call_for, notification, backend-gap
- **severity**: high（影响 claim / unstake / withdraw / deposit 四个签名模块的通知体验）
- **created**: 2026-04-22
- **source**: sodex-next-feature vault-claim 迁移 /k:debug 插桩实测

### 触发场景

从老项目(sodex-web)迁移**任意 callForPermit 类签名操作**(vault claim / unstake / withdraw / deposit)的通知链路时。老项目依赖 explorer WebSocket 的 `SODEX_USER_NOTICE` + `sodex_call_for` channel 推送 pending / success / failed 三态来驱动 toast,但新项目(sodex-next-feature)实测**后端未对该 channel 推送**。

### 典型症状

- 订阅 `SODEX_USER_NOTICE` + `${userAddress}@sodex_call_for` 成功(WS socket ACK 了 SUBSCRIBE),但签名动作完成后**handler 永远不触发**
- 同一 WS 的 `sodex_deposit` / `sodex_withdraw` channel 正常推送(说明 WS 连接健康)
- 对比 sodex-web 同一代码在同一 endpoint **能收到**`sodex_call_for` 推送

### 根因

新项目 `src/features/trade/containers/useDepositNotice.ts:17-18` 注释:

```
Only handles deposit/withdraw notifications.
Stake (sodex_call_for) is deferred until the staking feature is refactored.
```

后端推送配置和前端 staking feature 同步 deferred——即使前端订阅,后端也不推。必须等后端侧重新启用 `sodex_call_for` push(与 stake 模块一起回归)。

### 避坑动作

1. **不要基于"WS 推送对齐老项目"设计通知链路**——会卡死
2. 所有 callForPermit 签名 mutation(claim/unstake/withdraw/deposit)都走**手动 notify 方案**:
   - `useMutation.onMutate` → `notify.loading(..., { autoClose: false })`
   - `useMutation.onSuccess` → `toast.dismiss(loadingId)` + `notify.success(...)` + invalidate queries
   - `useMutation.onError` → `toast.dismiss(loadingId)` + `handleServiceError(...)`
3. 保留 `waitForTransactionReceipt(3 confirmations)` 作为成功判定的唯一可靠信号(不能像 trade withdraw 那样 HTTP 200 就视为成功——claim/unstake 涉及跨域 bridge,需要真实上链确认)
4. 在模块 spec 里显式标注"WS 驱动待后端启用后再切换",不写"TODO 接 WS"避免被下个开发者误导走错路

### 检测建议

**快速验证是否已经启用**(开工前 5 分钟实验):

```ts
// 临时插桩(用 /k:debug 工作流更规范):
DepositNoticeWs.getInstance().subscribe(
  "SODEX_USER_NOTICE",
  `${userAddress}@sodex_call_for`,
  (msg) => console.log("[probe]", msg),
);
// 做一次真实 claim/unstake
// 30 秒内有回调 → 后端已启用,走 WS 方案
// 零回调 → 仍 deferred,走手动 notify
```

### 本次案例

- **日期**:2026-04-22
- **模块**:vault-claim
- **实测**:一次完整 claim(签名 + POST `/biz/mirror/call_for_permit` + 3 confirmations)周期内,`SODEX_USER_NOTICE + 0xf936...@sodex_call_for` 零 handler 回调
- **对比**:同一 WS 实例的 `sodex_deposit` / `sodex_withdraw` 在 Spot 充提时正常推送
- **决策**:claim 落地方案 A(手动 notify + `waitForClaimReceipt`);unstake / withdraw / deposit 按同方案复制

### 追加案例:vault-unstake (2026-04-22)

- **模块**:vault-unstake
- **验证方式**:落地时直接沿用 claim 方案 A,未再独立插桩 probe(claim 已证 WS push 未启用,同一 channel/type 无需重复验证)
- **实测期待**:unstake 一次真实操作理论上也应零 `sodex_call_for` 回调。若后端未来启用推送,本模块需与 claim 同步切到 WS 驱动
- **遗留动作**:后端启用 `sodex_call_for` push 后,
  1. `useSubmitVaultClaim` 删除 `onMutate/onSuccess/onError` 三段 notify,改由 WS 驱动
  2. `useSubmitVaultUnstake` 同步改
  3. 建 shared `useVaultCallForStatusNotify` container(订阅 `sodex_call_for` + store + toast 去重),对应老项目 `spotOrder.handleClaimMessage/handleWithdrawMessage/handleDepositMessage` 三态状态机
  4. `waitForClaimReceipt(3 confirmations)` 可移除(WS push 的 `executeStatus: Success` 作为成功信号)
  5. 4 个模块(claim/unstake/withdraw/deposit)统一切换

### 切换 WS 方案的触发条件(未来)

满足以下任一条件即可切 WS 驱动:

- 后端明确通知"`sodex_call_for` push 已启用"
- 实测做一次真实 callForPermit 操作,`SODEX_USER_NOTICE + @sodex_call_for` 有 handler 回调
- 新项目 `useDepositNotice.ts:17-18` 的 deferred 注释被移除

切换时统一升级 4 个模块(claim/unstake/withdraw/deposit),参考老项目 `models/spotOrder.ts` 的 `handleClaimMessage` / `handleWithdrawMessage` 状态机。
