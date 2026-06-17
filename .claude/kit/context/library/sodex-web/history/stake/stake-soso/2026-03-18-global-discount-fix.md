# 全局 Trading Fee Discount 修复

**日期**: 2026-03-18 | **类型**: fix | **范围**: stake

---

## 变更概述

修复 StakeSoso 弹窗在非 `/stake` 页面打开时 Trading Fee Discount 始终显示 0% 的问题。改为组件内部调用 `useStakeData()` 获取 yourStaked，任意入口都能正确显示 discount。

---

## 核心变更

### 1. 移除 yourStaked props

**文件**: `src/components_tw/modals/stakeSoso/StakeSoso.tsx`

```typescript
// 之前
interface StakeSosoProps extends InjectModalProps {
  yourStaked?: string;
}
const StakeSoso: React.FC<StakeSosoProps> = ({ yourStaked = "0" }) => {

// 之后
type StakeSosoProps = InjectModalProps;
const StakeSoso: React.FC<StakeSosoProps> = () => {
```

### 2. 内部获取 yourStaked

**文件**: `src/components_tw/modals/stakeSoso/StakeSoso.tsx`

```typescript
const { raw: stakeDataRaw } = useStakeData();
const { discount } = useStakingDiscount(stakeDataRaw.yourStaked, amount);
```

通过 ahooks `cacheKey` 共享缓存，`/stake` 页面已加载时无额外请求。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/components_tw/modals/stakeSoso/StakeSoso.tsx` | 修改 | 移除 props、内部调用 useStakeData |
| `src/pages/stake/hooks/useStakeData.ts` | 修改 | 注释 staleTime 配置（暂不启用） |

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/stake/stake-soso-guide.md`
- **Spec**: `.cursor/kit/spec/2026-03-18-stake-soso-global-discount.md`
