# 批次 1a-slp-ui 验收归档

**日期**:2026-04-20
**范围**:VaultStats 组件改造 — 字段对齐老项目 + Props 化 + 按钮接 stub
**结果**:✅ 通过

---

## 1. 产出

### 新建
- `src/features/vault/components/VaultStats/types.ts`
  - `VaultStatsData` / `AvailabilityBalance` / `ClaimData` / `VaultStatsProps`
- `src/features/vault/components/VaultStats/mock.ts`
  - `MOCK_VAULT_STATS` + `safeTrigger` 兜底 opener stub

### 修改
- `src/features/vault/components/VaultStats/index.tsx`
  - 字段:删 PNL / Past Month Return 卡 → 加 1Y Return / NAV 卡
  - Props 化:所有数值/回调从 props 读
  - ActionLink 加 `onClick` + `disabled`
  - 拆子组件:`AvailabilityCard` + `ClaimCard` + `StatsRow`
  - 布局:`HStack` → `Grid cols={4}`,Claim `col-span-2` — 保证上下行列对齐
- `src/features/vault/pages/VaultPage.tsx`
  - 传 `{...MOCK_VAULT_STATS}`

---

## 2. 验收门禁

**自动**
- ✅ `pnpm tsc --noEmit` vault 相关 0 错(trade `BalancesTable.tsx` 2 处 error 为 pre-existing)
- ✅ `pnpm eslint src/features/vault/` 0 错

**手动**(`pnpm dev` → `/vault`)
- ✅ 上行 4 卡:TVL `116.91M` + `$59.84M` / 1Y Return `1.14%` / NAV `1.0115` / MAG7.ssi/USDC `0.511`,高度一致
- ✅ 下行 3 卡:ValueChain / Base 各占 1 列 + Claim 占 2 列,列边与上行对齐
- ✅ 5 个按钮点击,控制台输出 `[vault-stats stub] Error: Not Implemented: vault-<module>`
- ✅ 余额 0 → disabled 生效(灰 + 不可点)
- ✅ `claim.processing` undefined → Processing spinner 行隐藏

---

## 3. 遇到并修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | 上行 4 卡高度不齐(TVL 有 subtext,其他没有) | 改 `align="stretch"`,后改用 `Grid cols={4}` |
| 2 | 上下行列边不对齐(下行用 `w-79.25` 固定宽) | 统一 `Grid cols={4}`,Claim `col-span-2` |
| 3 | lint `w-[317px]` 建议 `w-79.25` | 迁移到 Grid 后整体删除该硬编码 |

---

## 4. 下游一致性扫描

grep `01b-slp-data.md` / `01c-tabs-ui.md` / `02-05`:

- ✅ `01b-slp-data.md` 引用 `VaultStatsProps` / `MOCK_VAULT_STATS` 与 1a 实际产出完全一致
- ✅ `01c-tabs-ui.md` 不引用 VaultStats 类型
- ✅ 模块 2-5 不引用 VaultStatsProps(dialog input 各自定)

---

## 5. 遗留给下游(1b-slp-data)

- 按 `VaultStatsProps` 冻结形状组装 `useVaultSLPViewModel()`
- `VaultPage.tsx` 替换:`<VaultStats {...useVaultSLPViewModel()} />`
- 删 VaultPage 里 `import { MOCK_VAULT_STATS }` 行(mock.ts 保留供调试)
- queryKeys 追加:`vault.slpStats` / `mag7Balance` / `cooldown`

---

## 6. 功能回退声明

无(1a 只做 UI,数据态由 1b 接入,暂用 mock;功能未减少)。

---

## 7. 结论

✅ 1a-slp-ui 通过,1b-slp-data 可启动。
