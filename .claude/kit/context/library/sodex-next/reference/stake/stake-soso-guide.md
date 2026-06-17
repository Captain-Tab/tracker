# Stake SOSO 弹窗功能指南

> 涵盖 Stake SOSO 弹窗（StakeSosoDialog）的完整数据流、计算逻辑、按钮状态、精度规范。
> 对应代码：`src/features/staking/components/StakeSosoDialog/`

> ⚠️ 与 [stake-page](./stake-page-guide.md) 配合使用：弹窗由 stake-page 的 YourStakedCard / MobileStakeButton / `?action=stake` 入口触发，依赖外部传入的 `rawAvailable` / `rawYourStaked` props。

---

## 🎯 功能概述

弹窗主体让用户输入 SOSO 数量，实时预览 SSI Boost 系数 + Trading Fee Discount 提升档位，最终走 ValueChain 链上签名提交质押。

### 核心特性

1. **My Total SSI Value 全局聚合**：调 SSI Gateway 三接口 + 链上读 6 类合约，4 分量加和
2. **Cooldown 4 代币聚合**：sMAG7/sDEFI/sMEME/sUSSI × wallet+proxy 双账户
3. **LP 锁仓精确计算**：`AssetLock.lockDatas[0]` + `ERC20.balanceOf`（decimals=18）
4. **Boost 系数实时**：`floor(stakeUsd / boostTotalUsd × 100)`，clamp [0, 1000]，最大 11x
5. **5 档按钮状态机**：Insufficient Balance / Enable Staking / Stake，按优先级路由
6. **gas 扣减后精确收到 sSOSO**：`receiveAmount = max(0, amount - 0.001)` 4 位小数 ROUND_DOWN

---

## 🏗️ 组件结构

```
src/features/staking/components/StakeSosoDialog/
├── index.tsx               # 弹窗壳（openStakeSosoDialog 暴露）
├── StakeSosoContent.tsx    # 主内容（4 区块：My SSI / Discount+Boost / Amount / Submit+Unstake）
├── StakeReviewStep.tsx     # 确认提交 step（review 视图）
└── StakeSosoSkeleton.tsx   # 加载骨架屏
```

### 弹窗入口

```ts
// 从 stake-page 触发
import { openStakeSosoDialog } from '@/features/staking/components/StakeSosoDialog';
await openStakeSosoDialog({ rawAvailable, rawYourStaked });
```

### Props 契约

| Prop | 类型 | 来源 |
|---|---|---|
| `rawAvailable` | `string` | `useStakingBalancesQuery().rawAvailable`（VC native + Spot WSOSO） |
| `rawYourStaked` | `string` | `useStakingBalancesQuery().rawYourStaked`（仅 ValueChain 质押量） |
| `onSubmit` | `(amountInput, receiveAmount) => void` | 弹窗壳传入 mutation 回调 |
| `isPending` | `boolean` | mutation pending 态 |

---

## 📊 我的 SSI 总资产计算（My Total SSI Value）

### 数据源

通过 `useBoostTotalQuery()` 调 `computeTotalSsiUsd(walletAddress)`：

```
totalSsiUsd = holdingUsd + stakingUsd + lpUsd + valueChainLpExtra
```

### 第一批并发请求（6 个）

| 数据 | 接口/合约 | 链 |
|---|---|---|
| `holdingTokens` | SSI GW `POST /portfolio/info` | API |
| `stakingTokens` | SSI GW `POST /portfolio/staking/list` | API |
| `lpTokens` | SSI GW `POST /portfolio/lp/list` | API |
| `slpRaw` | `SLP.balanceOf(owner)` | Base |
| `navRaw` | `SLP.NAV()` | Base |
| `cooldownMap` | `cooldownInfos(wallet+proxy)` × 4 代币 | Base |

### 第二批并发请求（依赖第一批 tokenList）

| 数据 | 链 | decimals | 用途 |
|---|---|---|---|
| `baseBalances` | Base | 8（MAG7_DECIMALS） | holding+staking 所有 SSI 代币的 `ERC20.balanceOf` |
| `vcMag7` / `vcSmag7` | ValueChain | 8 | VMAG7 / VSMAG7 `balanceOf` |
| `lpBalances` | Base | 18（LP_DECIMALS） | `AssetLock.lockDatas` + `ERC20.balanceOf` |

---

### Cooldown 聚合（fetchAllCooldownSplit）

合约：`cooldownInfos(account)` → `(cooldownAmount, cooldownEndTimestamp)`

| stakeToken | Base 合约地址 | 对应 holdingToken |
|---|---|---|
| `sMAG7.ssi` | `0x3d8f0ddb4bb9332Cb89dEC22d273d9be1a91530b` | `MAG7.ssi` |
| `sDEFI.ssi` | `0x5eaa203F4406951a5B1ED197267B437Cf6aF03f1` | `DEFI.ssi` |
| `sMEME.ssi` | `0x2A3736d94bC681015F73Be3Daf8180156F8a6BE5` | `MEME.ssi` |
| `sUSSI` | `0x7f811E881693af12D84976D59fF3Fb0Eaf135524` | `USSI` |

**双账户合并**：
- 通过 `userToAccount(wallet)` 取 proxy 地址（VAULT_USER_TO_ACCOUNT_ADDRESS = `0xe5C7bbeEFb207BaA5BddbbDf14eb846D0a11223f`）
- 若 proxy 非零地址，每个 stakeToken 同时读 wallet + proxy 的 `cooldownInfos`，合并 amount

**到期判定**：
```
endMs = cooldownEndTimestamp × 1000
available   = (endMs > 0 && endMs <= Date.now())   → 冷却期已结束，可赎回
unavailable = !available                            → 冷却期未结束
```

输出：`Map<stakeTokenLower, { available, unavailable }>`，4 个 stakeToken × 2 字段。

---

### 各分量计算

#### holdingUsd（每个 holding token，排除 soso/ssoso）

```
MAG7.ssi:                  baseBalance + vcMag7 + cooldownMap[smag7.ssi].available
DEFI.ssi/MEME.ssi/USSI:    baseBalance + cooldownMap[s{token}].available
其他 holding 代币:          baseBalance

holdingUsd += actualAmt × usdPrice
```

#### stakingUsd（排除 soso/ssoso/smag7.slp）

```
sMAG7.ssi:                       baseBalance + vcSmag7 + cooldownMap[smag7.ssi].unavailable
sDEFI.ssi/sMEME.ssi/sUSSI:       baseBalance + cooldownMap[s{token}].unavailable
其他 staking 代币:                baseBalance

stakingUsd += actualAmt × usdPrice
```

#### lpUsd（每个 LP token，排除 soso/ssoso）

```
locks  = AssetLock.lockDatas(lpToken, owner)[0]    # decimals=18
holds  = ERC20.balanceOf(lpToken, owner)            # decimals=18
lpUsd += (locks + holds) × usdPrice
```

> AssetLock 合约地址：`0x935A4B1F6F3E891a226b2522ac22d45Ce5839383`（Base 链 hardcoded）

#### valueChainLpExtra（VC 上的 sMAG7.SLP Vault）

```
slpBalance     = formatUnits(SLP.balanceOf(owner), slpDecimals)
navRate        = formatUnits(SLP.NAV(), VAULT_TOKEN_DECIMAL)
mag7UsdPrice   = stakingTokens.find('smag7.slp'|'smag7.ssi').usdPrice ?? holdingTokens.find('mag7.ssi').usdPrice ?? 0

valueChainLpExtra = slpBalance × navRate × mag7UsdPrice
```

---

### 显示格式

```
totalSsiUsd > 0 → "$" + boostTotalUsd.toFixed(2)   例: "$19.12"
totalSsiUsd = 0 → null（显示 "--"）
```

`queryKey: queryKeys.staking.boostTotal(address)`，`staleTime: 60_000ms`。

---

## ⚡ SSI Boost coefficient

`StakeSosoContent.tsx`：

```
stakeUsd     = parseFloat(amount) × sosoPrice
boostPercent = floor(stakeUsd / boostTotalUsd × 100)，clamp [0, 1000]

boost        = (1 + boostPercent / 100).toFixed(2) + "x"   例: "1.13x"
boostChange  = boostPercent > 0 ? "+{N}%" : "0%"           例: "+13%" / "0%"
```

> ⚠️ `boostChange` 在 boostPercent=0 时输出 `"0%"`（无 `+` 号），对齐老项目 `boostChange === "0%"`。

### 11x 上限提示（boostPercent ≥ 1000）

显示感谢文案 + 还需质押多少 SOSO：

```
requiredSosoFor11x = boostTotalUsd × 10 / sosoPrice
```

格式：
- `< 0.0001` → 显示 `< 0.0001`
- 否则 `requiredSosoFor11x.toFixed(4)`

### SOSO 价格来源

`configApi.fetchSosoPrice()`，`queryKey: queryKeys.market.sosoPrice()`，`staleTime: 60_000ms`。

---

## 🏷️ SoDEX Trading Fee Discount

```
previewStaked    = rawYourStaked + amount（用户当前输入）
previewTierIndex = getCurrentTierIndex(previewStaked, STAKING_TIERS)
discountDisplay  = STAKING_TIERS[previewTierIndex].discount + "%"
```

> 实时根据用户 `amount` 输入预览质押后的 tier 跳档。

---

## 💰 Amount 输入区

### 自动填入（onMount）

```
useEffect(() => {
  amount = ROUND_DOWN(rawAvailable, 4位小数)，去除尾零
}, []);  // 仅挂载时执行一次
```

### Balance on ValueChain 展示

```ts
formatBalance4(rawAvailable) = ROUND_DOWN(rawAvailable, 4位小数)，去除尾零
```

### USD 估算

```
estimatedUsd = "~$" + (amount × sosoPrice).toFixed(2)
```

### receiveAmount（扣 gas 后实际收到的 sSOSO）

```
receiveAmount = max(0, amount - 0.001)，ROUND_DOWN 4位小数
// 0.001 SOSO = 链上 gas 手续费固定值
```

### Max 按钮

```ts
handleMax() => {
  amount = ROUND_DOWN(rawAvailable, 4位小数)
}
```

### Focus / Blur 行为

- `onFocus`：amount 为 "0" 时清空（提升输入体验）
- `onBlur`：去尾点（"5." → "5"）+ 去尾零（"5.000" → "5"）

---

## 🎮 按钮状态（5 种优先级）

| 优先级 | 条件 | 文案 | 是否禁用 |
|---|---|---|---|
| 1 | `isZeroBalance`（rawAvailable = 0） | Insufficient Balance | 是 |
| 2 | `isInsufficient`（amount > rawAvailable） | Insufficient Balance | 是 |
| 3 | `needsEnableStaking`（!isAuthenticated 或 !apiKeyValid） | Enable Staking | enabling 时禁用 |
| 4 | `isTooSmall`（amount ≤ 0.001 即不足扣 gas） | Stake | 是 |
| 5 | 正常 | Stake | 否 |

### Enable Staking 行为

不进入 staking mutation，独立走 `enableTrading()` 流程（对齐 Vault 模式，`@/features/trade` `useEnableTrading`）。

```ts
if (needsEnableStaking) {
  void enableTrading();
  return;
}
onSubmit(amount, receiveAmount);  // 真正的 stake mutation
```

### Insufficient Balance 视觉

输入框文字变红：`text-status-down`（NumberInput `classes.input` 条件）。

---

## 🛢️ Gas 费用展示

```
固定 = 0.001 SOSO
USD  = Math.ceil(0.001 × sosoPrice × 100) / 100   # 向上取整到 2 位小数
显示 = "<0.001 SOSO (≈$x.xx)"
```

> 对齐老项目 `≈$0.01`（小金额向上取整避免显示 `$0.00`）。

---

## 💬 Toast 文案分阶段切换

`useSubmitStake.mutationFn` 在不同阶段切换 loading toast 文案，让用户对中间态有感知（特别是 transfer + spot 提前刷新时形成视觉因果链）：

| 阶段 | toast 文案 | 触发位置 |
|---|---|---|
| onMutate（开局） | `"Staking SOSO..."` | mutation 开始 |
| 进入 transfer | `"Transferring SOSO to ValueChain..."` | needsTransfer 分支 setStep("approving") 后 |
| 进入 stake on-chain | `"Confirming stake on chain..."` | sendStakeTransaction 调用前 |
| onSettled 成功 | `"Staking successful!"` | onSettled |
| onSettled 失败 | `"User cancelled transaction."` / 错误信息 | onSettled |

切换实现：`closeNotify()` 后立即 `notify.loading(newMsg)`。`closeNotify` 仅关闭 loading 类 toast，不影响最终 success/warning/error 显示。

> 设计目的：transfer 完成 + spot retry 触发后，spot 余额会先于 stake on-chain receipt 减少（约 5-7s 提前量）。toast 文案切换让用户理解"这是 transfer 阶段，spot 在变；下一阶段是 stake on chain"，避免"我的 SOSO 凭空消失"的困惑。

---

## 🔢 精度规范汇总

| 场景 | 精度 | 方向 | 工具 |
|---|---|---|---|
| Balance on ValueChain（弹窗内） | 4位小数 | ROUND_DOWN | decimal.js |
| Amount 输入 / Max 填入 | 4位小数 | ROUND_DOWN | decimal.js |
| receiveAmount | 4位小数 | ROUND_DOWN | decimal.js |
| USD 估算（estimatedUsd） | 2位小数 | ROUND_HALF_UP（toFixed） | JS number |
| Gas fee USD | 2位小数 | ROUND_UP（Math.ceil） | JS number |
| My Total SSI Value | 2位小数 | ROUND_HALF_UP（toFixed） | JS number |
| boostPercent | 整数 | Math.floor | JS number |
| SSI baseBalances | 8 位（MAG7_DECIMALS） | formatUnits | viem |
| LP balances | 18 位（LP_DECIMALS） | formatUnits | viem |
| SOSO（输入用） | 18 位（SOSO_DECIMALS） | parseUnits / formatUnits | viem |

---

## 📍 涉及合约地址（与 stake-page 共用）

| 合约 | 地址 | 链 | 用途 |
|---|---|---|---|
| Asset Lock | `0x935A4B1F6F3E891a226b2522ac22d45Ce5839383` | Base | LP `lockDatas(token, owner)` |
| Vault userToAccount | `0xe5C7bbeEFb207BaA5BddbbDf14eb846D0a11223f` | Base | proxy 地址查询 |
| Base sMAG7.ssi | `0x3d8f0ddb4bb9332Cb89dEC22d273d9be1a91530b` | Base | sMAG7.ssi 余额 + cooldown |
| Base sDEFI.ssi | `0x5eaa203F4406951a5B1ED197267B437Cf6aF03f1` | Base | sDEFI.ssi cooldown |
| Base sMEME.ssi | `0x2A3736d94bC681015F73Be3Daf8180156F8a6BE5` | Base | sMEME.ssi cooldown |
| Base sUSSI | `0x7f811E881693af12D84976D59fF3Fb0Eaf135524` | Base | sUSSI cooldown |
| VMAG7 | `0x3887A01Af83E53c960469d60908DEB83748f22FB` | ValueChain | VC 上 MAG7.ssi 余额 |
| VSMAG7 | `0xa17B0537af8687080B7bFAa8C5EEA4EcD6481870` | ValueChain | VC 上 sMAG7.ssi 余额 |
| SLP（NAV） | 同 SLP_TOKEN_ADDRESS | ValueChain | sMAG7.SLP 余额 + NAV |

---

## 🔗 跨 Feature 依赖

| 调用方 | 被依赖 feature |
|---|---|
| `useBoostTotalQuery` | `@/features/auth` → `useAuthState`（address） |
| `useBoostTotalQuery` | `@/features/vault` → `fetchSlpBalance` / `fetchVaultNav` / `VAULT_TOKEN_DECIMAL` |
| `StakeSosoContent` | `@/features/auth` → `useAuthState`（isAuthenticated, apiKeyValid） |
| `StakeSosoContent` | `@/features/trade` → `useEnableTrading`（Enable Staking 流程） |
| `StakeSosoContent` | `@/features/market/infra/api/configApi` → `fetchSosoPrice` |
| `StakeSosoContent` | `domain/stakingTierCompute` → `getCurrentTierIndex` |
| `StakeSosoContent` | `domain/constants` → `STAKING_TIERS` |

---

## 🔐 鉴权与邮箱用户兼容

弹窗内部不直接拿 address，而是通过 `useBoostTotalQuery` 内部的 `useAuthState().address`：

```
StakeSosoContent
  └── useAuthState() { isAuthenticated, apiKeyValid }   # 仅判断按钮状态
  └── useBoostTotalQuery()
        └── useAuthState() { address }                  # Privy 邮箱兼容
              └── useQuery({ enabled: !!address, queryFn: () => computeTotalSsiUsd(address) })
```

> 全程不用 wagmi `useAccount()`。Privy 邮箱用户的 embedded wallet 不一定立刻进 wagmi，但 `useAuthState().address` 在 Privy 登陆完成后立即可用。

---

## 🌐 环境配置依赖

弹窗的 My Total SSI Value 完全依赖 SSI Gateway 三接口（`portfolio/info` / `staking/list` / `lp/list`），底层通过 `ssiGwClient`：

```ts
// src/shared/infra/httpClient.ts
export const ssiGwClient = createClient(import.meta.env.VITE_SSI_GW_URL);
```

**所有环境必须定义 `VITE_SSI_GW_URL`**：

| 文件 | 值 |
|---|---|
| `.env.development` | `/proxy/ssi-gw`（Vite 反向代理） |
| `.env.preview` | `https://ssi-gw.sosovalue.com` |
| `.env.production` | `https://ssi-gw.sosovalue.com` |

⚠️ **预发版陷阱**：缺失 `VITE_SSI_GW_URL` 时 ky 退化为相对 URL，请求发到当前 origin → 405 Method Not Allowed → My Total SSI Value 显示 `--`。

---

## 📦 React Query 缓存策略

| Query | queryKey | staleTime |
|---|---|---|
| `useBoostTotalQuery` | `staking.boostTotal(address)` | 60_000ms |
| `configApi.fetchSosoPrice` | `market.sosoPrice()` | 60_000ms |

骨架屏触发条件：`boostTotalLoading === true` 时渲染 `StakeSosoSkeleton`。

---

## 🔁 数据刷新机制（needsTransfer 路径）

> 2026-05-06 新增。背景：`spotAccountStateOptions` 设了 `staleTime: Infinity` + `refetchOnMount/Focus/Reconnect: false`（HTTP 一次性 + WS 增量设计），因此 `useSubmitStake` 的 `invalidateQueries({['staking']})` **不会**让 spot account state 重新拉取。当 stake 走 `needsTransfer=true` 路径（实际从 Spot 划转 SOSO 到 EVM-Funding），spot 余额已变但前端 cache 不会自动同步。

修复采用两个独立但协同工作的机制：

### A. `useSpotAccountStoreSync` 桥接（被动 / WS 主路径）

stake 页面 `useStakingPageViewModel` 挂载 `useSpotAccountStoreSync()`（来自 `@/features/trade`），把 `spotAccountStore` 的 WS push 同步到 React Query cache：

```ts
WS push → spotAccountStore.snapshot 更新
      → useSpotAccountStoreSync detects generation change
      → queryClient.setQueryData(['spot', 'accountState', address], snapshot)
      → useBalancesQuery / 派生 hook 自动响应
```

> trade 页面的 `useSpotAccountSync` 现在内部也是先调 `useSpotAccountStoreSync` 再加 trade 成交 toast；行为对 trade 页面透明，不变。

### B. `useSpotRefetchAfterTransfer` 主动重试（HTTP 兜底）

`containers/useSpotRefetchAfterTransfer.ts`：

| 行为 | 实现 |
|---|---|
| 触发时机 | `useSubmitStake.mutationFn` transfer 分支末尾（`triggerSpotRefetchRetry(addr)`） |
| 重试策略 | `[2_000, 5_000]` ms 两段重试，覆盖后端 transfer settlement 时间窗口 |
| HTTP 路径 | `queryClient.refetchQueries({queryKey: queryKeys.spot.accountState(address)})` —— 主动绕开 `staleTime: Infinity` |
| 连续 stake 防堆叠 | 每次调用清掉前一次未 fire 的 timer |
| 卸载清理 | `useEffect` cleanup `clearTimeout` 全部 pending timer |
| 失败容错 | `.catch(() => {})` 静默吞掉，不影响 mutation 链路 |

代码骨架：

```ts
const RETRY_DELAYS_MS = [2_000, 5_000] as const;

return useCallback((address: string) => {
  timersRef.current.forEach(clearTimeout);
  timersRef.current = [];
  RETRY_DELAYS_MS.forEach((delayMs) => {
    const id = window.setTimeout(() => {
      void queryClient.refetchQueries({queryKey: queryKeys.spot.accountState(address)})
        .catch(() => {});
    }, delayMs);
    timersRef.current.push(id);
  });
}, [queryClient]);
```

### 协同机制

- **WS 推送正常时**：`useSpotAccountStoreSync` 桥接是主路径，[2s, 5s] retry 是兜底（拿到的可能是同一份 settled snapshot，无副作用）
- **WS 滞后 / 命中中间态**：[2s, 5s] retry 主动拉一次 HTTP 拿 settled 状态，覆盖 cache
- **后端 settlement >5s 的极端情况**：仅靠 WS push 兜底；超过 5s 没推过来，需要下次 mount 或下一次 stake 触发 retry

### 设计取舍

> ⚠️ 该方案违反了 `useSpotAccountStateQuery.ts` 注释的"关掉 RQ 的所有自动 refetch"原则。trade-off：stake 是低频操作，对后端无压力；HTTP 与 WS push 的写入冲突理论上可能让 cache 短暂回退到旧值，但下一次 WS push 会校准。

---

## 🧪 验证用例

经过日志精确对账的 2 个钱包账户：

| 账户 | rawYourStaked（VC） | totalSsiUsd | stakeUsd | boostPercent | boost |
|---|---|---|---|---|---|
| Account A | 6.0674 SOSO | $19.116055631482237 | 2.57 | 13 | 1.13x |
| Account B | 6.0674 SOSO | $146.84734122957244 | 2.54 | 1 | 1.01x |

新项目与老项目（sodex-web）输出精确到小数点后 12 位一致。

---

## 🔄 历史变更

### 2026-05-06 — Stake 后 spot 余额刷新修复 + Toast 阶段化

**根因**：`useSubmitStake` 走 `needsTransfer=true` 路径时，`transferSosoSpotToEvm` 实际从 Spot 划转 SOSO 到 EVM-Funding；但 mutation 完成后只 `invalidateQueries({['staking']})`，**不覆盖 spot.accountState**。spot 那条 query 设了 `staleTime: Infinity`，导致 stake 页面下 `rawAvailable` 中的 spot 部分**永久 stale**。

**修复**：

1. **新增 `useSpotRefetchAfterTransfer` hook**（`containers/useSpotRefetchAfterTransfer.ts`）
   - `[2_000, 5_000]` ms 两段 retry，主动 `refetchQueries(spot.accountState)`
   - useRef 存 timer ids + useEffect cleanup（unmount 自动清）
   - 连续 stake 时清掉前一次未 fire 的 timer

2. **`useSubmitStake` transfer 分支末尾调 `triggerSpotRefetchRetry(addr)`**
   - 在 `pollVcBalance` 之后立即 schedule retry
   - mutation 链路本身不阻塞（fire-and-forget timer）

3. **拆分 `useSpotAccountSync`**（`features/trade/containers/useSpotAccountSync.ts`）
   - 拆出纯 cache sync 部分为 `useSpotAccountStoreSync()`
   - 原 `useSpotAccountSync()` 内部调它 + 保留 trade 成交 toast
   - 通过 `@/features/trade/index.ts` export `useSpotAccountStoreSync`

4. **`useStakingPageViewModel` 挂 `useSpotAccountStoreSync()`**
   - 让 stake 页面期间 WS push 也能同步到 React Query cache
   - 修复"用户在 stake 页面期间任何 spot 变化都不刷新"的更广问题

5. **Toast 文案分 3 阶段切换**（UX polish）
   - `Staking SOSO...`（onMutate）→ `Transferring SOSO to ValueChain...`（transfer）→ `Confirming stake on chain...`（stake）
   - 缓解"spot 在 stake receipt 之前 5-7s 就减少"带来的视觉困惑

**验证**：iter 4-5 日志，2-3 次连续 stake（含 needsTransfer=true）spot 余额都按预期减少；retry [2s, 5s] 都按预期 fire。

**遗留风险**（可接受）：
- WS push race：stake receipt 等待期间 WS 推送 spot 仍会立即更新（视觉上 spot 先于 staked）。toast 文案切换缓解了这个困惑。
- 后端 settlement >5s：仅靠 WS push 兜底，超过则需下次 mount 触发。

---

### 2026-04-30 — migration-stake-bugfix

### 关键修复（5 项）

1. **删除 `useStakingBoostCalc` 调用**
   - `useStakingBoostCalc` 缺少 LP 分量、缺少 sDEFI/sMEME/sUSSI cooldown，输出值偏低（$4.24 vs 真实 $19.12）
   - 改用 `useBoostTotalQuery` 完整聚合（消除 7 个重复 API 请求）

2. **新增 `fetchAllCooldownSplit`（覆盖 4 代币）**
   - 之前只读 sMAG7.ssi 一个，缺失 sDEFI/sMEME/sUSSI 共 ~$5.17 USD（DEFI.ssi available=5.94, MEME.ssi=5.10, USSI=2.0）
   - 现在批量读 4 代币 × 2 账户（wallet + proxy），按 `endTimestamp` 拆 available/unavailable

3. **新增 `fetchLpBalances`**
   - 之前用 `oldTotalAmount`（API 字段，常返回 0）
   - 改为链上 `AssetLock.lockDatas(token, owner)[0] + ERC20.balanceOf(token, owner)`，decimals=18

4. **`boostChange` 零值格式对齐**
   - 之前 `"+0%"`，改为 `"0%"`（对齐老项目 `boostPercent > 0 ? "+N%" : "0%"`）

5. **环境配置补齐**
   - `.env.preview` 补 `VITE_SSI_GW_URL=https://ssi-gw.sosovalue.com`，修复 405 报错

### 数据迁移源

来自 `sodex-web/src/hooks/useBalances/index.ts boostTotalReq` + `helper.ts`：
- `getCooldownInfosBatch` / `mergeCooldownInfo`（cooldown 双账户聚合）
- `getLpBalance`（AssetLock.lockDatas + ERC20.balanceOf）
- `getValueChainData`（VMAG7/VSMAG7/SLP/NAV/sMag7Slp）
- `sumList` + `sumLP`（per-token 加权求和）

---

## 🧭 关联功能

- [stake-page](./stake-page-guide.md) — 弹窗的入口页面（YourStakedCard / MobileStakeButton / `?action=stake`）
