---
description: 金额/数字精度计算规范（仅 sodex-web/sodex-next）。当处理金额、余额、价格、转账等数值计算时自动触发。
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

# 精度计算规范

## 目录

| ID | 规则 | 错误模式 | 正确模式 |
|----|------|----------|----------|
| P1 | 数值比较 | `parseFloat(a) > b` | `calculate(a).gt(b)` |
| P2 | 数值运算 | `parseFloat(a) - b` | `calculate(a).sub(b).done()` |
| P3 | 格式化 | `toFixed(4)` | `floorToDecimal(a, {decimal:4})` |
| P4 | MobX依赖 | `[store.obj]` | `[field1, field2]` |
| P5 | 滑点容差 | 精确比较 | `diff.lte("0.0001")` |
| P6 | 精度常量 | UI精度截断链上金额 | `TOKEN_DECIMAL` vs `DEFAULT_DECIMAL` |

---

## P1: 数值比较

```typescript
// ❌ parseFloat 精度丢失
if (parseFloat(a) > parseFloat(b)) { ... }

// ✅ calculate 库
import { calculate } from "@/utils/calculate";

calculate(a).gt(b)   // >
calculate(a).gte(b)  // >=
calculate(a).lt(b)   // <
calculate(a).lte(b)  // <=
calculate(a).eq(b)   // ===
calculate(a).gt("0") // 正数判断
```

---

## P2: 数值运算

```typescript
// ❌
const diff = parseFloat(a) - parseFloat(b);

// ✅
const diff = calculate(a).sub(b).done();
const sum = calculate(a).add(b).done();
const product = calculate(a).mul(b).done();
```

---

## P3: 格式化显示

```typescript
// ❌ toFixed 四舍五入，显示值可能 > 实际值
parseFloat(amount).toFixed(4)

// ✅ floorToDecimal 向下取整
import { floorToDecimal } from "@/utils/decimals";

floorToDecimal(amount, { decimal: 4, trimTrailingZeros: true })
```

---

## P4: MobX 依赖

```typescript
// ❌ 整体对象引用不变时不触发更新
const total = useMemo(() => {
  return store.balances?.evm + store.balances?.spot;
}, [store.balances]);

// ✅ 提取具体字段
const evm = store.balances?.evm;
const spot = store.balances?.spot;

const total = useMemo(() => {
  return calculate(evm || "0").add(spot || "0").done();
}, [evm, spot]);
```

---

## P5: 滑点容差

```typescript
// 场景 1：判断余额是否足够（允许小额误差）
const diff = calculate(target).sub(current);
if (diff.lte("0.0001") && calculate(current).gt("0")) {
  const actual = calculate(current).lt(target) ? current : target;
  await execute(actual);
}

// 场景 2：判断操作必要性（避免小额操作）
const SLIPPAGE = "0.0001";
if (transferRaw.gt(SLIPPAGE)) {
  // 差值 > 滑点，需要执行操作
  await executeTransfer(amount);
} else if (transferRaw.gt("0")) {
  // 差值在滑点内，跳过操作，调整目标金额为实际余额（避免超额）
  unstakeAmount = rawEvmAmount;
}
```

---

## P6: 精度常量

```typescript
// ❌ 用 UI 精度截断链上金额
const transferAmount = floorToDecimal(diff, { decimal: DEFAULT_DECIMAL }); // 4 位
// 问题：0.00005 被截断为 0，导致该转账的没转

// ✅ 区分 UI 精度和 Token 精度
export const DEFAULT_DECIMAL = 4;  // UI 显示精度
export const TOKEN_DECIMAL = 8;    // token 链上精度

// 链上操作用 TOKEN_DECIMAL
const transferAmount = floorToDecimal(diff, { decimal: TOKEN_DECIMAL });
// UI 显示用 DEFAULT_DECIMAL
const displayAmount = floorToDecimal(balance, { decimal: DEFAULT_DECIMAL });
```
