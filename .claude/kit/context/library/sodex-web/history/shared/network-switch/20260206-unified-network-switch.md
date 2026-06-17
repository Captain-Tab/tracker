# 统一网络切换逻辑

## 核心需求

更新项目中的切换网络逻辑，将"切换网络"与"执行操作"合并为一步，提升用户体验。

### 目标组件

| 组件 | 路径 |
|------|------|
| Transfer | `src/components_tw/modals/spot/transfer/index.tsx` |
| Withdraw | `src/pages/_components/withdraw/WithdrawModal.tsx` |
| Deposit | `src/pages/_components/deposit/DepositStepByStep.tsx` |

### 参考组件

- VaultPreTradeButton
- VaultWithdrawButton

---

## 执行步骤

### 步骤1：了解代码逻辑 ✅
- 访问参考组件
- 了解如何将切换网络和执行操作的按钮合并为一个

### 步骤2：封装核心逻辑 ✅
- 封装逻辑：首先检测目标网络和现在执行的网络是否一致
- 如果不一致则切换到目标网络
- 减少显示"switch to xxx chain"的步骤
- 输出：`src/hooks/useAutoSwitchNetwork.ts`
- 更新 VaultPreTradeButton 和 VaultWithdrawButton

### 步骤3：更新 Transfer 组件 ✅
- 使用 executeWithAutoSwitch 实现
- 无 linter 错误

### 步骤4：更新 Withdraw 组件 ✅
- 使用 executeWithAutoSwitch 实现
- Withdraw 操作统一在 ValueChain 上执行
- 无 linter 错误

### 步骤5：更新 Deposit 组件 ✅
- 使用 executeWithAutoSwitch 实现
- 支持动态链选择（Base/Ethereum/Arbitrum/ValueChain）
- 更新 FlashDepositButton 组件接收网络状态
- 无 linter 错误

### 步骤6：优化重复代码 ✅
将 3 处重复的 checkNetwork + performSwitch 模式优化为 executeWithAutoSwitch：
- Transfer: handleConfirm → 包装 SOSO/permit 操作
- Withdraw: withdrawFor + toSubmit(SOSO) → 包装签名和转账操作
- Deposit: handleFlashDeposit → 包装 flashDeposit 操作

---

## 核心流程图

### executeWithAutoSwitch 流程（用户操作触发）

```
用户点击操作按钮（Deposit/Withdraw/Transfer）
    ↓
executeWithAutoSwitch(action) 执行
    ↓
checkNetwork() 检查当前网络
    ├─ [已在目标网络] → 直接执行 action()
    │
    └─ [不在目标网络] → performSwitch()
          ↓
        setIsSwitching(true)
        UI 显示: "Switching to {chainName}..."
          ↓
        switchToTargetNetwork(targetChainId)
          ↓
        checkNetworkWithRetry() 轮询检查（最多 5 秒）
          ├─ [成功] → 执行 action()
          │
          └─ [失败] → 尝试添加网络
                ├─ needsManualAdd=true → handleAddNetwork()
                └─ needsManualAdd=false → switchToTargetChain()
                      ↓
                checkNetworkWithRetry() 再次轮询
                  ├─ [成功] → 执行 action()
                  └─ [失败] → notify.error() + return undefined
```

---

## 核心组件列表

| 组件/Hook | 路径 | 说明 |
|-----------|------|------|
| **useAutoSwitchNetwork** | `src/hooks/useAutoSwitchNetwork.ts` | 统一网络切换 Hook |
| **chainConfig** | `src/config/chainConfig.ts` | 多链配置映射表 |
| **Transfer** | `src/components_tw/modals/spot/transfer/index.tsx` | Funding→Spot 转账 |
| **WithdrawModal** | `src/pages/_components/withdraw/WithdrawModal.tsx` | 提现弹窗 |
| **DepositStepByStep** | `src/pages/_components/deposit/DepositStepByStep.tsx` | 充值流程 |
| **FlashDepositButton** | `src/pages/_components/deposit/_components/FlashDepositButton.tsx` | 充值按钮 |

---

## 实现思路

### Hook 设计

```typescript
interface UseAutoSwitchNetworkReturn {
  isSwitching: boolean;           // 是否正在切换
  isCorrectNetwork: boolean;      // 是否在目标网络
  targetChainName: string;        // 目标链名称
  targetChainId: number;          // 目标链 ID
  checkNetwork: () => Promise<boolean>;
  performSwitch: () => Promise<boolean>;
  executeWithAutoSwitch: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}
```

### 多链支持

```typescript
// src/config/chainConfig.ts
export const CHAIN_CONFIG_MAP: Record<SupportedChain, ChainConfig> = {
  VALUE_CHAIN: { chainId: 286623, name: "ValueChain", needsManualAdd: true },
  BASE_ETH:    { chainId: 8453,   name: "Base",       needsManualAdd: false },
  ETHEREUM:    { chainId: 1,      name: "Ethereum",   needsManualAdd: false },
  ARBITRUM:    { chainId: 42161,  name: "Arbitrum",   needsManualAdd: false },
};
```

### 按钮文案

- **切换中**: `Switching to {chainName}...`
- **正常**: `Confirm` / `Deposit` / `Withdraw`

---

## 切换网络情况汇总

### 各组件切换条件

| 组件 | 触发条件 | 目标链 | 说明 |
|------|----------|--------|------|
| **Transfer** | `isFundingToSpot` (Funding → Spot) | VALUE_CHAIN | 仅 Funding 转 Spot 需要切换 |
| **Withdraw** | 所有提现操作 | VALUE_CHAIN | 提现统一在 ValueChain 执行 |
| **Deposit** | 所有充值操作 | 动态选择 | 根据用户选择的链决定 |

### Deposit 支持的链

| 链名称 | SupportedChain | chainId | needsManualAdd |
|--------|----------------|---------|----------------|
| Base | `BASE_ETH` | 8453 | false |
| Ethereum | `ETHEREUM` | 1 | false |
| Arbitrum | `ARBITRUM` | 42161 | false |
| ValueChain | `VALUE_CHAIN` | 286623 | true |

### 链名称映射（getSupportedChainByName）

```
"base" / "base_eth" → BASE_ETH
"ethereum" / "eth" / "mainnet" → ETHEREUM
"arbitrum" / "arb" → ARBITRUM
"valuechain" / "value_chain" → VALUE_CHAIN
```

### getChainId vs getCurrentChainId

| 函数 | 来源 | Privy 支持 | 推荐 |
|------|------|------------|------|
| `getChainId` | `useAddNetwork.ts` | ✅ 支持 | ✅ 当前使用 |
| `getCurrentChainId` | `chainUtils.ts` | ❌ 不支持 | 仅内部使用 |

**结论**：`getChainId` 更完善，支持所有钱包类型，无需替换。

---

## 风险控制

| 风险 | 缓解措施 |
|------|----------|
| 网络切换失败 | notify.error 提示 + 中止操作 |
| 用户拒绝切换 | 捕获错误 + rejected 提示 |
| ValueChain 未添加 | 自动调用 handleAddNetwork() |
| 标准链切换失败 | 使用 switchToTargetChain() 重试 |

---

## 更新记录

- **2025-01-27**: 初始版本，封装 useNetworkSwitch Hook
- **2026-02-06**: 统一重构
  - 创建 useAutoSwitchNetwork + chainConfig
  - 优化为 executeWithAutoSwitch 模式
  - 支持多链（ValueChain/Base/Ethereum/Arbitrum）
  - 更新 Transfer/Withdraw/Deposit 三组件
  - 删除旧 useNetworkSwitch.ts
