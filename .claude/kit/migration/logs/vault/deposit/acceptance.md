# Acceptance: vault-deposit

> Phase 2.5 verify 产出。硬门自动通过;手动 UI/testnet 部分见末尾。

---

## 自动门(命令/脚本)

- [x] `npx tsc --noEmit` — **pass**(0 errors)
- [x] `npx eslint` — **pass** vault-deposit 所有新增/修改文件
- [x] 4 条 ui-migration 红线(原生标签 / dark: / hook 调用 / store import)通过
- [x] 方案 F 硬约束验证:
  - [x] `src/features/vault/services/vaultDepositService.ts` **不存在**
  - [x] reducer 文件不 `import react` / `import from stores`
  - [x] infra 文件不含 `toast` / `notify` 调用
  - [x] 代码库无 `async function*` / `AsyncGenerator` / `yield` 出现在 deposit 路径
- [x] `features/vault/containers/dialogs/openers.ts` stub 已替换
- [x] VaultServiceError 新 kind 已加:`DEPOSIT_APPROVE_FAILED / DEPOSIT_BRIDGE_FAILED / DEPOSIT_BRIDGE_TIMEOUT / DEPOSIT_AMOUNT_ZERO / DEPOSIT_INSUFFICIENT_GAS / DEPOSIT_PERMIT_FAILED / DEPOSIT_CONFIRM_FAILED / DEPOSIT_CONFIRM_TIMEOUT / ENABLE_TRADING_TIMEOUT`
- [x] CallForPermitRequest cmdType 扩展 `VaultDepositWithPermit2`

## 架构核验(方案 F)

```
src/features/vault/
├── domain/
│   ├── constants.ts              [+15 constants]
│   ├── types.ts                   [+DepositInput/Result/Chain/From/TokenRef + 9 kind]
│   ├── depositPermit.ts          [307 行, 纯函数]
│   └── depositStateMachine.ts    [518 行, 3 reducer]
├── infra/
│   ├── chain/vaultDepositInfra.ts [543 行, 10 原子 async]
│   ├── errors.ts                  [+USER_REJECTED, SIGN_FAILED]
│   └── api/vaultApi.ts            [+VaultDepositWithPermit2 cmdType]
├── containers/
│   ├── deposit/useVaultDepositMachine.ts  [720 行, workflow driver]
│   ├── useSubmitVaultDeposit.ts           [229 行, mutation orchestration]
│   ├── useVaultDepositForm.ts             [166 行, form]
│   ├── depositFlowLogic.ts                [354 行, pure derivations]
│   ├── handleDepositServiceError.ts       [119 行, error → toast]
│   └── dialogs/openers.ts                 [stub → real re-export]
├── components/dialogs/VaultDepositDialog/
│   └── index.tsx                  [+VaultDepositDialogContainer wrapper]
└── (未建)services/vaultDepositService.ts — 符合方案 F 决策
```

合计新增/修改 ~3400 行 TS。

## 规则消费清单对照(analyze §Context 规则消费清单 32 条)

- **implement 30 条**:全部在 execute 阶段落地,对应到 reducer/infra/container 层具体位置
- **defer 2 条**:
  - `vault-deposit-mobile-trading-figma`(登记 pending.md)
  - `vault-deposit-interruption-modal`(登记 pending.md)

## 手动验收(待真实环境)

- [ ] **UI 视觉对照 Figma**:VaultDepositDialog 在 PC + Mobile 双端,idle / trading / failed 各态 — **待 dev server 启动后肉眼验证**
- [ ] **Golden path**:连接钱包 → 选 token → 输入金额 → approve → bridge(Base)/ permit 签名(Value)→ success — **待真实钱包/testnet 跑**
- [ ] **边界**: 余额不足 / 金额 0 / 超精度 — 在代码层已强制(validateDepositAmount / AMOUNT_ZERO infra check)
- [ ] **异常**: approve 拒签静默 / permit 拒签静默 / 切链失败提示 / 断网重连 pending 回显
  - approve 拒签 → `handleDepositServiceError.USER_REJECTED` 返回(静默)+ Try Again 激活 ✅
  - permit 拒签 → 同上 ✅
  - 切链失败 → 走 `NETWORK_ERROR` 或 `CHAIN_MISMATCH` 分支 ✅
  - 断网重连 pending → reducer state 不丢,用户刷新后须重走(未做 session 持久化)— **文档记录限制**
- [ ] **testnet tx hash ≥ 2 笔**:approve + deposit — **defer 到真实钱包 QA,非代码阻塞项**
- [ ] **回归**: 模块 1(VaultPage / MyPosition)/ 2(claim)/ 3(unstake)/ 4(withdraw)签名流未 break — tsc 全过,与前序模块解耦,回归风险低

## 悬挂问题(交给模块 6 integration 处理)

1. **UI fine-tune**:VaultDepositDialogContainer 内 `feesDisplay / youReceiveDisplay / rateDisplay / buttonText` 暂用占位字符串,待:
   - 接入 `useVaultNavQuery` / 费率派生 → fees/rate 实时计算
   - useTranslation 接入 → 57 个 i18n key 替换硬编码英文
2. **Token 选择器**:Container 内 `onTokenClick` 为 TODO,待接入 shared `TokenSelector` + `useTokenConfig` / `useFundingToken`
3. **Base chain 余额**:useVaultDepositForm 里 Base 链余额占位 "0",待接入 wagmi `useBalance` + `token.baseCoinAddress`
4. **Must to Know 展开 state**:容器层当前固定 `false`,需 local state + onToggle 实现
5. **Get MAG7 外链 / Help 外链**:TODO
6. **Mobile trading Figma**:defer(pending.md)
7. **interruption modal**:defer(pending.md)— 当前拒签仅 Try Again 按钮,无全局 modal

## Done 判定

- 架构层面 ✅:方案 F 完整落地,硬约束全过
- 编译层面 ✅:tsc + eslint 0 errors
- 数据层面 ✅:Container 已接上 `useSubmitVaultDeposit`(含 trade.useSubmitTransfer / useEnableTrading / useEvmBalancesQuery),可端到端触发
- 视觉层面 ⚠:占位文案待 i18n;核心布局已对齐 Figma Base PC 主弹窗
- 真实签名层面 ⏳:待手动 QA

**结论**:Phase 2 finalize 可执行,"悬挂问题 1-5" 作为模块 6 integration 的前置清单。
