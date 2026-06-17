# 1b-slp-data analyze

**日期**:2026-04-20
**目的**:开工前锁定外部依赖(合约 ABI / 链地址 / ticker 存在性)

---

## 1. Cooldown 合约 ABI(来自 `sodex-web/src/abi/CooldownInfosAbi.json`)

合约地址:`VAULT_COOLDOWN_INFOS_ADDRESS = 0x3d8f0ddb4bb9332Cb89dEC22d273d9be1a91530b`(Base chain,id=8453)

```ts
// 函数 1:读用户 cooldown 状态
cooldownInfos(account: address) returns (
  uint256 cooldownAmount,       // 正在 cooldown 的 sMAG7 数量(raw,18 decimals)
  uint256 cooldownEndTimestamp  // Unix 秒,0 表示未发起 cooldown
)

// 函数 2:读全局 cooldown 时长
cooldown() returns uint48       // 秒(例 7 天 = 604800)
```

**推导规则**(domain 层):
- `processing` = `cooldownAmount > 0 && now < cooldownEndTimestamp` 时填 `formatBalance(cooldownAmount)`,否则 `null`
- `withdrawable` = `cooldownAmount > 0 && now >= cooldownEndTimestamp` 时填 `formatBalance(cooldownAmount)`,否则 `"0"`
- `cooldownEndTimestamp` 直接透传(UI 需要展示倒计时)

---

## 2. Base 链 MAG7/sMAG7 token 地址

**结论**:旧项目**未硬编码**。从 ValueChain `SODEX_TOKEN_QUERY` 合约 `getAllCoins()` 动态读取,匹配 `coinSymbol === 'MAG7.ssi' / 'sMAG7.ssi'` 且 `chain === 'BASE_ETH'` 的 `coinAddr`。

**本批次策略**(澄清 §简化方案 b):
- 不复刻 `getAllCoins()` 调用
- `fetchMag7BalanceBase(address)` 先返回 `{ sMag7: "0", mag7: "0" }`
- 加 TODO:"等 Base token 地址落定后补读"
- `/vault` 下行 Base 卡显示 `0 / 0`(按钮 disabled),视觉仍符合 1a

---

## 3. Ticker `vMAG7.ssi` 在新项目存在性

**grep 结果**(`src/`):
- trade feature 有 `useAllTickers` / `useTickerSymbols`(`features/trade/containers/*`)
- 常见 symbol 格式:`MAG7ssi/USDC`(display)、`MAG7ssi_USDC`(routing)
- **未发现 `vMAG7.ssi` 直接 key**

**本批次策略**:
- `useVaultStatsQuery` 尝试 `useTickerSymbols(["vMAG7.ssi", "MAG7ssi/USDC"])` 双 key 兜底
- 两个都 undefined → price 字段 null,UI 显示 "--"
- 加 TODO:"等 shared ticker 整理后迁回,或确认 vault 专用价格接口"

---

## 4. HTTP API(来自 `sodex-web/src/http/vault/index.ts`)

| 函数 | URL | Method | baseURL |
|---|---|---|---|
| `getVaultInvestInfo` | `/biz/vaultdata/position_by_address` | POST | `ALPHA_MIRROR_API_SERVER_URL` |
| `getVaultRoiApy` | `/biz/vaultdata/roi_apy` | POST | `ALPHA_MIRROR_API_SERVER_URL` |
| `getVaultNavCurve` | `/biz/vaultdata/nav_curve` | POST | `ALPHA_MIRROR_API_SERVER_URL` |

**本项目已有端点**:
- `features/auth/infra/api/authApi.ts:190` 已有 `biz/vaultdata/position_by_address` 调用,但返回值仅用于 auth 场景
- 决定:**不跨 feature 复用 authApi**,vault feature 内独立封装 3 个 HTTP,职责清晰

**baseURL 迁移**:
- 旧用 `ALPHA_MIRROR_API_SERVER_URL`(专用域名)
- 新项目走 `shared/infra/httpClient`,若 `ALPHA_MIRROR` 对应域名已在 httpClient 基建内 → 直接用;否则需要补配置(本批次遇到再处理)

---

## 5. Empty / No wallet 规则

- 未连钱包:`address === undefined` → Query `enabled: false`,ViewModel 返 all-zero + TODO
- 连钱包但无 vault position:API 返 `{tvl: 0, pnl: 0, ...}` → normalize 后 "0",UI 照常显示

---

## 6. 本批次开工前确认项

- [x] Cooldown ABI 锁定
- [x] Base 链 token 地址策略确定(先占位 0)
- [x] Ticker 兜底策略确定
- [x] 3 HTTP 端点 + baseURL 确认
- [ ] `ALPHA_MIRROR_API_SERVER_URL` 在新项目 httpClient 是否可用(实施时验证)
