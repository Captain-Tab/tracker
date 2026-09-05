# fix: isAccountEmpty 覆盖 native + xyz + spot 三维度

> 修复 HYPE-discovery filterWatchReady 的「当前持仓过滤」：clearinghouseState 漏传 dex 参数导致股票代币（xyz:*）持仓查不到，加上漏查现货余额，把「合约转现货」和「仅股票代币持仓」误判成「账户清空」。

## 验收场景

### G1: xyz 股票代币持仓不再误判清空
GIVEN HYPE promoted address 仅持有 xyz 股票代币（clearinghouseState dex=xyz 返回 assetPositions 3 个，dex=native 返回空）
WHEN fetchClearingRisk 并行查 native + xyz + spot
THEN isEmpty=false（有 xyz 持仓）

### G2: 现货余额不再误判清空
GIVEN HYPE promoted address 合约持仓空（native+xyz 都空）但 spotClearinghouseState 有 USDC $441 万
WHEN isAccountEmpty(state, xyzState, spotState)
THEN isEmpty=false（有现货余额）

### G3: 真清空仍判空
GIVEN HYPE promoted address native 空 + xyz 空 + 现货余额 0
WHEN isAccountEmpty
THEN isEmpty=true

### G4: 股票代币濒爆仓被拦截
GIVEN xyz 持仓距强平价 < 10%
WHEN minLiquidationDistance 合并 native + xyz assetPositions
THEN liqDist < LIQ_DIST_MIN → 濒爆仓拦截

### G5: 现货粉尘余额判空
GIVEN spotClearinghouseState balances 总和 ≤ $0.01
WHEN isAccountEmpty
THEN isEmpty=true（粉尘视为空）

## 涉及文件
- service/HYPE-discovery/api/index.mjs
- service/HYPE-discovery/process/observing.mjs
- service/HYPE-discovery/process/domain.test.mjs

## 新增抽象
- fetchSpotState() — 查 spotClearinghouseState
- isAccountEmpty(state, xyzState, spotState) — 三维度清空判断
- minLiquidationDistance 合并 native + xyz
