# Vault Deposit 功能指南

## 🪙 币种体系说明

### Base Chain vs Value Chain 币种映射

| 链 | 链上 Symbol | 显示名称 | 说明 |
|---|---|---|---|
| **Base Chain** | MAG7.ssi | MAG7.ssi | Base 链原生 MAG7 代币 |
| **Base Chain** | sMAG7.ssi | sMAG7.ssi | Base 链质押后的 sMAG7 代币 |
| **Value Chain** | vMAG7.ssi | MAG7.ssi | Value Chain 上的 MAG7 代币（带 v 前缀） |
| **Value Chain** | vsMAG7.ssi | sMAG7.ssi | Value Chain 上的 sMAG7 代币（带 v 前缀） |

**关键点：**
- Base Chain 和 Value Chain 上是**不同的代币**，通过桥接连接
- Value Chain 上的币种在代码中使用 `v` 前缀（vMAG7.ssi、vsMAG7.ssi）
- 显示给用户时统一为 MAG7.ssi、sMAG7.ssi

### Stake/Unstake 操作

| 操作 | 输入 | 输出 | isStake | 说明 |
|---|---|---|---|---|
| **Stake** | MAG7.ssi | sMAG7.ssi | true | 质押 MAG7 获得 sMAG7（参与 SSI 空投） |
| **Unstake** | sMAG7.ssi | MAG7.ssi | false | 解除质押 sMAG7 赎回 MAG7 |

> Stake 流程：Value Chain MAG7 → 跨链到 Base → Base 上 Stake → 跨链回 Value Chain 变为 sMAG7

### Base Chain 桥接资金流向（统一 toClob=true）

```
Base Chain MAG7.ssi + toClob=true
    ↓ 桥接
Value Chain Spot 账户 (vMAG7.ssi)
    ↓ Transfer（Value Chain 步骤）
Value Chain EVM-Funding 账户 (vMAG7.ssi)
    ↓ Stake
Value Chain EVM-Funding 账户 (vsMAG7.ssi)
    ↓ Vault Deposit
SLP Vault

──────────────────────────────────

Base Chain sMAG7.ssi + toClob=true
    ↓ 桥接
Value Chain Spot 账户 (vsMAG7.ssi)
    ↓ Transfer ← 新增步骤（统一逻辑后）
Value Chain EVM-Funding 账户 (vsMAG7.ssi)
    ↓ Vault Deposit
SLP Vault
```

### Value Chain 存款账户选择逻辑

| 场景 | 资金来源账户 | 是否需要 Transfer | 是否需要 Stake |
|---|---|---|---|
| **Value Chain 直接存 MAG7** | Spot/EVM-Funding（用户选择） | 根据选择 | ✅ 是 |
| **Value Chain 直接存 sMAG7** | Spot/EVM-Funding（用户选择） | 根据选择 | ❌ 否 |
| **Base Chain 桥接 MAG7** | **自动：Spot** | ✅ 是 | ✅ 是 |
| **Base Chain 桥接 sMAG7** | **自动：Spot** | ✅ 是 | ❌ 否 |

---

## 🏗️ 架构概览

### 分层状态机设计

```
┌──────────────────────────────────────────────────┐
│           useVaultDeposit (顶层协调)               │
│                                                  │
│  ┌────────────────┐      ┌──────────────────┐  │
│  │ Base Chain     │  →   │ Value Chain      │  │
│  │ useBaseChain   │      │ useValueChain    │  │
│  │ Deposit        │      │ Deposit          │  │
│  └────────────────┘      └──────────────────┘  │
│         ↓                         ↓             │
│    2 步骤                     动态步骤           │
│  (Approve, Confirm)      (Transfer, Stake...)   │
└──────────────────────────────────────────────────┘
```

### 关键特性

1. **Base 阶段内聚**
   - Base Chain 子状态机在 `bridge_settling` 内完成合约轮询
   - 完成后根据 `isNewUser` 直接跳转到 Enable Trading 或 Vault

2. **智能 Try Again**
   - 只在用户拒绝交易时显示
   - 双层状态机协调重试

3. **桥接入账机制**
   - 统一 `toClob = true`，所有资金入 Value Chain Spot
   - 桥接完成与否由合约查询确认，无需依赖 Spot 余额

---

## 📋 状态转换

| 当前状态           | Action / 条件                     | 下一状态               |
|--------------------|-----------------------------------|------------------------|
| idle               | START (needsBaseChain = true)     | base_chain_phase       |
| idle               | START (needsBaseChain = false)    | value_chain_phase      |
| base_chain_phase   | BASE_CHAIN_COMPLETED & 老用户     | value_chain_phase      |
| base_chain_phase   | BASE_CHAIN_COMPLETED & 新用户     | enable_trading         |
| base_chain_phase   | BASE_CHAIN_FAILED                 | failed (base_chain)    |
| enable_trading     | ENABLE_TRADING_COMPLETED          | value_chain_phase      |
| enable_trading     | ENABLE_TRADING_FAILED             | failed (enable_trading)|
| value_chain_phase  | VALUE_CHAIN_COMPLETED             | completed              |
| value_chain_phase  | VALUE_CHAIN_FAILED                | failed (value_chain)   |
| failed (base_chain)| RETRY                             | base_chain_phase       |
| failed (enable_trading)| RETRY                          | enable_trading         |
| failed (value_chain)| RETRY                            | value_chain_phase      |

### 状态流转图

```
┌────────────────────────────────────────────────────────────────────┐
│                    useVaultDeposit (顶层状态机)                      │
│                                                                    │
│  [idle]                                                            │
│    ├─ needsBaseChain = true  → [base_chain_phase] ─┐               │
│    │                                                ├─ 新用户 → [enable_trading] ─┐
│    │                                                └─ 老用户 ───────────────────┐│
│    │                                                                              ▼│
│    └─ needsBaseChain = false →───────────────────────────────────────→ [value_chain_phase] → [completed]
│                                                                    │
│  任何阶段失败 → [failed] → (RETRY) → 返回对应阶段                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 核心流程

### 场景 1：老用户（Base Chain → Value Chain）

```
用户点击 "Confirm"
    ↓
dispatch({ type: 'START' }) → reducer: { type: 'base_chain_phase' }
    ↓
╔═══════════════════════════════════════════════════════════╗
║  Phase 1: Base Chain 桥接（含 settle）                     ║
╚═══════════════════════════════════════════════════════════╝
baseChainDepositRef.current.execute()
    ├─ checking_allowance
    ├─ approving / approve_confirming
    ├─ bridge_confirming
    │   UI Confirm步骤三阶段:
    │   • idle: "Confirm in wallet" (等待用户确认)
    │   • processing: "Depositing into SoDEX (~3mins)" (交易已提交)
    │   • completed: "Confirm" (确认完成)
    └─ bridge_settling（合约轮询，最多20次×3秒）
        ↓
dispatch({ type: 'BASE_CHAIN_COMPLETED' })
    ↓
reducer 返回: { type: 'value_chain_phase' }（老用户直达 Vault）
    ↓
╔═══════════════════════════════════════════════════════════╗
║  Phase 2: Vault Deposit                                   ║
╚═══════════════════════════════════════════════════════════╝
valueChainDepositRef.current.execute()
    ├─ transfer (如需要，Spot → EVM-Funding)
    ├─ stake (MAG7 → sMAG7，如需要)
    ├─ approve (EIP-2612 Permit)
    ├─ confirm (签名)
    └─ confirm (链上执行)
        ↓
dispatch({ type: 'VALUE_CHAIN_COMPLETED' }) → { type: 'completed' }
    ↓
onSuccessRef.current()  ← 弹窗关闭，显示成功提示
```

### 场景 2：新用户（Base Chain → Enable Trading → Value Chain）

```
Base Chain 桥接阶段同场景 1（包含 bridge_settling）
    ↓
dispatch({ type: 'BASE_CHAIN_COMPLETED' })
    ↓
reducer 检测 configRef.current.isNewUser = true → { type: 'enable_trading' }
    ↓
╔═══════════════════════════════════════════════════════════╗
║  Phase 2: Enable Trading（新用户专属）                     ║
╚═══════════════════════════════════════════════════════════╝
    ├─ setIsEnableTrading(true)
    ├─ 签名创建账户 (signMessage / signMessageMobile)
    ├─ 轮询 userId 是否生成（最多10次×1秒）
    └─ dispatch({ type: 'ENABLE_TRADING_COMPLETED' })
        ↓
reducer → { type: 'value_chain_phase' }
    ↓
Phase 3: Vault Deposit（与老用户相同）
```

### 场景 3：Value Chain 直接存款

```
用户在 Value Chain 上选择 MAG7.ssi 或 sMAG7.ssi
    ↓
dispatch({ type: 'START' }) → config.needsBaseChain = false
    ↓
reducer 返回: { type: 'value_chain_phase' }  ← 直接进入 Vault 阶段
    ↓
╔═══════════════════════════════════════════════════════════╗
║  UI: CollapsiblePanel "Depositing to SLP Vault"           ║
║  - 支持折叠/展开                                          ║
║  - 失败时显示 WarningIcon                                 ║
╚═══════════════════════════════════════════════════════════╝
valueChainDepositRef.current.execute() → 直接执行 Vault 阶段
```

---

## 🔑 关键实现

### 1. Bridge settle 逻辑（合约轮询）

```typescript
const transaction = await readContract(wagmiConfig, {
  address: SOSO_DEPOSIT_CONTRACT_ADDRESS,
  abi: GET_TRANSACTION_ABI,
  functionName: "getTransaction",
  args: [BASE_CHAIN_IDENTIFIER, bridgeTxHash],
  chainId: VALUE_CHAIN_NETWORK.id,
}) as SosoBridgeTransaction;

const isBridgeTransactionSettled = (
  tx: SosoBridgeTransaction | null | undefined,
  targetHash: string
) => {
  if (!tx) return false;
  if (normalizeHash(tx.txHash) !== targetHash) return false;
  if (tx.chain?.toUpperCase() !== BASE_CHAIN_IDENTIFIER) return false;
  return Number(tx.status ?? 0) === 1;
};
```

**轮询策略**:
- 最多 20 次，间隔 3 秒（SETTLE_MAX_ATTEMPTS=15 实际配置）
- 匹配哈希 + status === 1 即视为成功
- 失败时写 warning，但允许流程继续到 Enable Trading / Vault

### 2. Try Again 错误检测

```typescript
const isUserRejectedError = (error: any): boolean => {
  const errorStr = JSON.stringify(error).toLowerCase();
  const message = (error.message || '').toLowerCase();
  const shortMessage = (error.shortMessage || '').toLowerCase();
  const details = (error.details || '').toLowerCase();
  const name = (error.name || '').toLowerCase();

  const rejectionKeywords = [
    'user rejected', 'user denied', 'user canceled',
    'rejected the request', 'userrejectedrequesterror',
    'denied transaction'
  ];

  return rejectionKeywords.some(keyword =>
    errorStr.includes(keyword) || message.includes(keyword) ||
    shortMessage.includes(keyword) || details.includes(keyword) ||
    name.includes(keyword)
  );
};
```

### 3. 双层状态机协调

```typescript
const retry = useCallback(() => {
  if (state.type === 'failed') {
    dispatch({ type: 'RETRY' });  // 1. 顶层退出 failed

    if (state.phase === 'base_chain') {
      baseChainDepositRef.current.retry?.();   // 2a. 子状态机 retry
    } else {
      valueChainDepositRef.current.retry?.();  // 2b. 子状态机 retry
    }
  }
}, [state]);
```

**关键**:
- Value Chain retry 使用 `value_chain_phase` 状态（不触发余额同步）
- Base Chain retry 使用 `base_chain_phase` 状态

### 4. getStepStatus 失败状态处理

```typescript
if (type === "failed") {
  const actualSteps = [];
  if (config.needsTransfer) actualSteps.push("transfer");
  if (config.needsStake) actualSteps.push("stake");
  actualSteps.push("approve", "confirm");

  const currentStepIndex = actualSteps.indexOf(step);
  const failedStepIndex = currentState.stepIndex;

  if (currentStepIndex < failedStepIndex) return "completed";   // 之前的步骤
  if (currentStepIndex === failedStepIndex) return "processing"; // 失败步骤
  return "pending";  // 之后的步骤
}
```

---

## 📁 文件结构

```
src/pages/vault/components/modals/funding/
├── _hooks/
│   └── useMag7Balance.ts                    # 余额管理
│
├── deposit/
│   ├── index.tsx                            # 弹窗主组件
│   ├── AccountSelector.tsx                  # 账户选择器
│   ├── BaseAccountInput.tsx                 # Base Chain 账户
│   │
│   └── transaction/
│       ├── Trading.tsx                      # 交易流程主组件
│       ├── CollapsiblePanel.tsx             # 可折叠面板
│       ├── ProcessIndicator.tsx             # 步骤指示器
│       ├── DepositToSodexStep.tsx          # SoDEX 步骤
│       │
│       └── _hooks/
│           ├── useVaultDeposit.ts          # 顶层状态机
│           ├── useBaseChainDeposit.ts      # Base Chain 状态机
│           ├── useValueChainDeposit.tsx     # Value Chain 状态机
│           └── types.ts                     # 类型定义
```

---

## 🎨 UI 结构

### Deposit 弹窗

```
┌─────────────────────────────────────┐
│  Deposit                            │
│                                     │
│  Chain: [Base ▼] [ValueChain]      │  ← 链选择
│                                     │
│  From: Base Account                 │  ← Base 链显示
│  Balance: 10.5 MAG7.ssi            │
│                                     │
│  或                                 │
│                                     │
│  From: [Spot ▼] [EVM-Funding]      │  ← Value Chain 显示
│  Balance: 8.0 MAG7.ssi             │
│                                     │
│  Amount: [_______]                  │
│                                     │
│  [Confirm]                          │
└─────────────────────────────────────┘
```

### Trading 流程

```
┌─────────────────────────────────────────────┐
│  5  [MAG7.ssi icon]  MAG7.ssi              │
│                                             │
│  ▼ Depositing to SoDEX                     │  ← Base Chain 阶段
│    ✓ Approve Spending Cap                  │
│    ⏳ Confirm in wallet                     │  ← idle
│    ⏳ Depositing into SoDEX (~3mins)        │  ← processing
│    ✓ Confirm                                │  ← completed
│                                             │
│  ▼ Depositing to SLP Vault                 │  ← Value Chain 阶段
│    → Transferring to EVM-Funding           │
│    → Stake MAG7.ssi to sMAG7.ssi           │
│    → Approve Spending Cap                  │
│    → Confirming in wallet                  │
│                                             │
│  [Try Again]                                │  ← 失败时显示（3秒后自动隐藏）
└─────────────────────────────────────────────┘
```

### 失败状态 UI

| 阶段 | WarningIcon | Loading Spinner | 面板可折叠 | Try Again 按钮 |
|---|---|---|---|---|
| **Base Chain 失败** | ✅ 显示 | ❌ 不显示 | ✅ 是 | ✅ 显示（3秒后隐藏）|
| **Enable Trading 失败** | ✅ 显示 | ❌ 不显示 | ✅ 是 | ✅ 显示（3秒后隐藏）|
| **Value Chain 失败** | ✅ 显示 | ✅ 显示 | ✅ 是 | ✅ 显示（3秒后隐藏）|

---

## 🔧 关键设计决策

### 1. 为什么将 settle 放在 Base 阶段？

**问题**: 早期在 Value Chain 阶段做余额轮询，既依赖 `user.id`，又让拓扑更复杂。

**方案**: 在 Base Chain 状态机内部新增 `bridge_settling`，直接通过合约确认交易是否入账。这样：
- Base 阶段就能给出准确反馈（统一 UI 步骤 approve→confirm→settle）
- 顶层状态机无需 `value_chain_from_base`，老用户直接跳到 Vault，逻辑更简单
- 新用户也能在 Enable Trading 之前得到明确的桥接结果

### 2. 资金去向（统一 toClob=true）

**统一逻辑**: 所有资金都去 Spot
- `toClob = true`（统一）：MAG7 和 sMAG7 都去 **Spot**
- sMAG7 会新增一个 Transfer 步骤（从 Spot → EVM-Funding）

### 3. MetaMask 交易冲突处理

**方案**:
1. approve 完成后等待 500ms
2. bridge 交易失败时，智能重试（最多 3 次，延迟递增）

---

## 🎓 术语表

| 术语 | 说明 |
|---|---|
| **Base Chain** | Base 区块链网络（Coinbase L2） |
| **Value Chain** | SoDEX 的 Layer2 网络 |
| **toClob** | 是否将资金转入 CLOB (Central Limit Order Book) 系统的 Spot 账户 |
| **Spot 账户** | 现货交易账户 |
| **EVM-Funding 账户** | 链上账户（EVM 兼容） |
| **Perps 账户** | 永续合约账户 |
| **Stake** | 质押 MAG7.ssi 获得 sMAG7.ssi |
| **Unstake** | 赎回 sMAG7.ssi 获得 MAG7.ssi |
| **Enable Trading** | 签名创建 SoDEX 账户，生成 user.id |
| **Permit** | EIP-2612 标准，无需 approve 交易的授权方式 |
| **Confirm 签名** | 用户在钱包确认 CallForPermit 签名（confirm_signing 状态） |
| **Confirm 执行** | 签名完成后提交到后端并等待链上处理（confirm_proceeding 状态） |
| **bridge_settling** | Base Chain 子状态机中合约轮询阶段，确认桥接入账 |

---

## 📝 修改记录

### 修改 #4: Value Chain 失败状态 UI 优化（2025-12-19）✅

**改进**:
1. **失败状态下已完成步骤正确显示**：
   - 修改 `getStepStatus` 函数，在 `failed` 状态下根据 `stepIndex` 判断各步骤状态
   - 失败步骤之前的步骤正确显示 `completed` 状态（绿色 ✓）
   - 失败步骤保持 `processing` 状态（loading spinner）

2. **RETRY 逻辑修复**：
   - stake 失败后直接重试 stake（不再错误回退到 transfer）
   - transfer 完成后资金已在 EVM-Funding，无需重新执行

3. **Value Chain 流程 UI 统一**：
   - Value Chain 直接开始的流程也使用 `CollapsiblePanel` 包装
   - 与 Base Chain 流程 UI 结构保持一致
   - 支持失败状态显示 WarningIcon

**影响**:
- ✅ 失败状态下用户能清晰看到哪些步骤已完成
- ✅ Try Again 重试当前步骤而非回退
- ✅ Value Chain 和 Base Chain UI 结构统一

---

### 修改 #3: UI 反馈优化（2025-12-05）✅

**改进**:
1. **Base Chain Confirm 步骤文案细化**：
   - idle: "Confirm in wallet" → 清晰提示用户需要在钱包确认
   - processing: "Depositing into SoDEX (~3mins)" → 交易已提交，等待入账
   - completed: "Confirm" → 确认完成

2. **Try Again 按钮超时机制**：
   - 点击后显示 "Retrying..." 并启动 3 秒定时器
   - 3 秒后自动隐藏按钮，避免 UI 卡住

3. **失败状态 UI 改进**：
   - 面板在失败状态下保持可折叠
   - Value Chain 失败时同时显示 WarningIcon 和 loading spinner
   - 提供更清晰的视觉反馈

---

### 修改 #2: 统一 Base Chain 桥接逻辑（toClob=true）（2025-11-07）✅

**变化**:

| 币种 | 修改前 | 修改后 |
|---|---|---|
| **MAG7** | toClob=true → Spot | toClob=true → Spot（无变化）|
| **sMAG7** | toClob=false → EVM-Funding | toClob=true → Spot（**新增 Transfer 步骤**）|

**影响**:
- ✅ MAG7 流程无变化
- ⚠️ sMAG7 流程增加 1 个 Transfer 步骤（从 2 步变为 3 步）
- ✅ 代码逻辑更简洁统一

---

### 修改 #1: Base Chain 引入 bridge_settling ✅

**问题**: 余额轮询依赖 userId，新用户体验不稳定。

**解决方案**: 在 Base 阶段增加 `bridge_settling`，通过合约确认交易，移除 `value_chain_from_base` 状态。

---

## 🔖 代码位置索引

| 功能 | 文件 | 行号 |
|---|---|---|
| 状态类型定义 | useVaultDeposit.ts | 30-37 |
| Reducer 逻辑 | useVaultDeposit.ts | 53-150 |
| 新用户判断 (isNewUser) | useVaultDeposit.ts | 202 |
| Value Chain From 判断（统一逻辑） | useVaultDeposit.ts | 247-265 |
| Enable Trading 逻辑 | useVaultDeposit.ts | 409-448 |
| Retry 逻辑 | useVaultDeposit.ts | 490-504 |
| Base Chain toClob 参数（统一逻辑） | useBaseChainDeposit.ts | 356 |
| Base Chain UI 步骤状态更新 | useBaseChainDeposit.ts | 380-420 |
| Bridge settle 轮询 | useBaseChainDeposit.ts | 470-528 |
| Confirm 步骤文案逻辑（三阶段） | DepositToSodexStep.tsx | 45-68 |
| Try Again UI & 超时机制 | Trading.tsx | 150-200 |
| Value Chain UI（CollapsiblePanel） | Trading.tsx | 327-349 |
| 错误检测函数 isUserRejectedError | Trading.tsx | 36-62 |
| 失败状态面板逻辑 | CollapsiblePanel.tsx | 31-55 |
| getStepStatus 失败状态处理 | useValueChainDeposit.tsx | 426-476 |
| RETRY 逻辑（直接重试当前步骤） | useValueChainDeposit.tsx | 312-341 |
| Confirm 拆分状态 | useValueChainDeposit.tsx | 96-99 |
| 步骤状态映射表 | useValueChainDeposit.tsx | 125-182 |
| Confirm 签名与执行逻辑 | useValueChainDeposit.tsx | 744-817 |
| Confirm 链上确认等待（waitForTransactionReceipt） | useValueChainDeposit.tsx | 850-865 |
| VAULT_DEPOSIT_SUCCESS 事件监听 | SLP.tsx | 248-265 |
| ProcessIndicator 扩展 | ProcessIndicator.tsx | 10-21, 119-121 |

---

## 📅 更新记录

### 2026-03-06: 表单金额被 useEffect 覆盖导致交易失败

**问题 1：** OKX 钱包显示 "第三方合约执行失败"，跳过 Approve 阶段直接进入 Bridge 导致失败

**问题 2：** 用户输入金额后点击 "Enable Trading"，金额变成 0

**根本原因：**
- `deposit/index.tsx` 中多个 `useEffect` 在 `selectedChain`、`isNewUser`、`token` 变化时触发 auto-fill 函数
- 这些函数会调用 `autoFillAmount(balance)`，当余额为 0 时设置金额为 "0.00"
- 问题 1：交易流程开始后状态变化仍触发 auto-fill，覆盖用户输入
- 问题 2：Enable Trading 完成后 `isNewUser` 从 `true` → `false`，触发 `useEffect`，此时 `tradingStatus` 仍是 "idle"

**修复：**
- `deposit/index.tsx`：4 个 auto-fill 函数添加 `if (tradingStatus !== "idle") return;` 守卫
- `deposit/index.tsx`：引入 `isNewUserRef`，`useEffect` 只依赖 `selectedChain?.chain`，不依赖 `isNewUser`
- `useBaseChainDeposit.ts`：添加 `if (amountRaw === BigInt(0)) throw new Error("Deposit amount cannot be zero");`

**与 2026-02-05 修复的兼容性：**
| 修复 | 文件 | 作用层次 | Ref 名称 |
|------|------|----------|----------|
| 本次修复 | `deposit/index.tsx` | 表单 auto-fill | `isNewUserRef` |
| 2026-02-05 修复 | `useVaultDeposit.ts` | 状态机流程控制 | `isNewUserSnapshotRef` |

两个 Ref 作用于不同层次，互不干扰。

---

### 2026-02-05: 新用户 Enable Trading 跳过问题修复

**问题：** 新用户 Base Chain 完成后，WS 推送导致 `isNewUser` 变为 `false`，跳过 Enable Trading

**根本原因：**
- Base 阶段完成后，WS 推送 `SODEX_USER_NOTICE` 消息
- 触发 `spotOrder.ts` 中的 `rootUser.setUserIdByAddress(data.userAddress)`
- 导致 `user.id` 被设置，`isNewUser` 从 `true` 变为 `false`
- 状态机跳过了 `enable_trading` 阶段，在 Value Chain 报错 "API key not found"

**修复：**
- `useVaultDeposit.ts` Line 141-159：添加 `isNewUser` 快照机制（`isNewUserSnapshotRef`），execute() 开始时锁定状态
- `useVaultDeposit.ts` Line 255-318：Enable Trading 阶段等待 `user.id` 就绪，最多重试 10 次（每次 1 秒）
- `useBaseChainDeposit.ts` Line 551：SETTLE_MAX_ATTEMPTS 从 10 增加到 15

---

### 2025-01-07: sMAG7 充值后 SLP 余额不更新问题修复

**问题：** Base 链 sMAG7 充值成功后，SLP.tsx 余额不自动更新

**根本原因：** `confirm_proceeding` 中没有等待链上确认（`waitForTransactionReceipt`），sMAG7 流程更快（不需要 stake），链上可能还没确认就触发了成功

**修复：**
- `useValueChainDeposit.tsx` Line 850-865：添加 `waitForTransactionReceipt` 等待链上确认
- `SLP.tsx` Line 248-265：添加 `VAULT_DEPOSIT_SUCCESS` 事件监听刷新余额
- `useValueChainDeposit.tsx`：移除多余的 `vault.updateMag7RelatedBalance()` 调用

---

最后更新: 2026-03-06
