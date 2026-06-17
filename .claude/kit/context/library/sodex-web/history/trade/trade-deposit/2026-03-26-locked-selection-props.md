# 添加锁定选择 Props

**日期**: 2026-03-26 | **类型**: feat | **范围**: trade-deposit

---

## 变更概述

为 DepositStepByStep 组件添加 `lockedCoin` 和 `lockedChain` 可选属性，支持锁定币种和链选择，禁止用户切换。

---

## 核心变更

### 1. Props 扩展

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

```typescript
interface DepositStepByStepProps extends InjectModalProps {
  coin?: CoinInfoData;
  coinSymbol?: string;
  chainId?: string;
  lockedCoin?: boolean;   // 新增：锁定币种选择
  lockedChain?: boolean;  // 新增：锁定链选择
}
```

### 2. UI 锁定逻辑

- 锁定时禁用下拉框 onClick 事件
- 锁定时隐藏 CaretDownIcon 箭头
- 锁定时移除 hover 效果和 cursor-pointer

### 3. StakingHero 应用

**文件**: `src/pages/stake/StakingHero.tsx`

```typescript
depositModal.open({
  coinSymbol: "sSOSO",
  chainId: "ValueChain",
  lockedCoin: true,
  lockedChain: true,
});
```

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `DepositStepByStep.tsx` | 修改 | 添加 lockedCoin/lockedChain Props 和锁定逻辑 |
| `StakingHero.tsx` | 修改 | 使用锁定参数打开弹窗 |

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/trade/trade-deposit-guide.md`
