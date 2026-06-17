# 余额快照 + 重试机制

**日期**: 2026-03-25 | **类型**: fix | **范围**: vault

---

## 变更概述

修复 Unstake 智能转账流程中的两个问题：transfer 过程中 UI 余额显示抖动、transfer 后 unstake 因余额同步延迟偶发失败。

---

## 核心变更

### 1. 余额快照机制

**文件**: `src/pages/vault/components/modals/funding/unstake/_hooks/useUnstakeWithTransfer.ts`

防止 transfer 过程中 UI 显示的余额抖动：

```typescript
// L56-91
const [snapshotBalance, setSnapshotBalance] = useState<string | null>(null);

const displayBalance = useMemo<TotalBalance>(() => {
  if (snapshotBalance !== null) {
    return { amount: snapshotBalance, evmAmount, spotAmount };
  }
  return totalBalance;
}, [snapshotBalance, totalBalance]);

// execute() 中
setSnapshotBalance(totalBalance.amount);  // 开始时快照
try { ... } finally {
  setSnapshotBalance(null);  // 结束时清除
}
```

### 2. 重试机制 + 滑点容差

**文件**: `src/pages/vault/components/modals/funding/unstake/_hooks/useUnstakeWithTransfer.ts`

处理 `floorToDecimal` 精度损失导致的余额差异：

```typescript
// L205-240
const RETRY_INTERVALS = [500, 1000, 2000];
const MAX_RETRIES = 3;

const executeUnstakeWithRetry = useCallback(async (targetAmount: string) => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // ...
    const diff = calculate(targetAmount).sub(currentEvmBalance);
    const isWithinSlippage = diff.lte("0.0001");  // 滑点容差
    
    if (isWithinSlippage && hasBalance) {
      const actualAmount = calculate(currentEvmBalance).lt(targetAmount)
        ? currentEvmBalance : targetAmount;
      return await executeUnstake(actualAmount);
    }
  }
  return false;
}, [...]);
```

### 3. 其他改动

- 移除 `unstake_in_progress` 通知及相关 i18n 翻译
- 使用 `calculate` 库进行精确比较，避免浮点精度问题
- 登录态校验优化

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/.../unstake/_hooks/useUnstakeWithTransfer.ts` | 修改 | 添加快照、重试机制 |
| `public/locales/*/vault.json` (11 个) | 修改 | 移除 unstake_in_progress |
| `src/@declares/i18next-resources.d.ts` | 修改 | 同步类型定义 |

---

## 追加变更：逻辑简化 + 依赖修复

**时间**: 2026-03-25 (同日追加)

### 变更内容

1. **简化 needTransfer 判断逻辑**
   - 移除重复的 `parseFloat` 判断，统一使用 `calculate` 库进行精度计算
   - 代码从 ~30 行简化为 ~15 行

2. **修复 useMemo 依赖项**
   - 提取 `evmSmag7` 和 `spotSmag7` 作为具体字段
   - 依赖从 `[valueChain.balances]` 改为 `[evmSmag7, spotSmag7]`
   - 确保 MobX observable 变化时正确触发更新

3. **unstakeAmount 不再调整**
   - 始终使用用户输入金额，边界情况由 transfer 逻辑处理

### 代码示例

```typescript
// 修改前
const amount = parseFloat(_inputAmount);
const evmBal = parseFloat(totalBalance.evmAmount);
needTransfer = amount > evmBal && evmBal >= 0;  // parseFloat 判断
if (needTransfer) {
  const transferRaw = calculate(_inputAmount).sub(rawEvmAmount);
  if (transferRaw.lte("0")) { needTransfer = false; }  // calculate 再次判断（重复）
}

// 修改后
const transferRaw = calculate(_inputAmount).sub(rawEvmAmount);
if (transferRaw.gt("0")) {  // 统一用 calculate 库
  // ...
}
```

---

## 追加变更：滑点容差 + 重试优化

**时间**: 2026-03-25 (同日追加)

### 变更内容

1. **重试配置优化**
   - `RETRY_INTERVALS = [500, 1000, 3000]`（原 `[500, 1000, 2000]`）
   - `MAX_RETRIES = RETRY_INTERVALS.length`（动态计算，避免不一致）
   - 总等待时间：4.5s

2. **滑点容差判断 transfer 必要性**
   - 差值 > 0.0001 才执行 transfer
   - 差值 <= 0.0001 时直接用 EVM 余额 unstake（避免超额）
   - 用户最多损失 ~$0.02，几乎无感知

3. **新增 TOKEN_DECIMAL 常量**
   - `TOKEN_DECIMAL = 8`：token 链上精度
   - 用于 transfer 金额计算，避免 UI 精度（4 位）截断

### 代码示例

```typescript
const SLIPPAGE = "0.0001";
let unstakeAmount = _inputAmount;

if (transferRaw.gt(SLIPPAGE)) {
  // 差值 > 滑点，需要 transfer
  const transferAmount = floorToDecimal(transferRaw.done(), { decimal: TOKEN_DECIMAL });
  await executeTransfer(transferAmount);
} else if (transferRaw.gt("0")) {
  // 差值在滑点内，不 transfer，用 EVM 余额 unstake
  unstakeAmount = rawEvmAmount;
}
```

### 测试覆盖

| 场景 | 差值 | 操作 | unstakeAmount | 结果 |
|------|------|------|---------------|------|
| EVM 充足 | ≤ 0 | 直接 unstake | 用户输入 | ✅ |
| 差值很小 | 0 < diff ≤ 0.0001 | 直接 unstake | EVM 余额 | ✅ |
| 差值较大 | > 0.0001 | transfer → unstake | 用户输入 | ✅ |

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/vault/vault-unstake-guide.md`
