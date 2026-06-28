# Spec 横切 · API 封装层（Phase0 底座）

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本横切单元自身，**冲突以总纲为准**。
> 依赖：总纲 §0 执行前置（`@nktkas/hyperliquid` 可用）、§3.2 函数签名、§3.4 复用件清单、§3.5 命名约定。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本横切。

---

## 背景与目的

本横切是 Phase0 底座的 **IO 收口层**，被 01-04 子件共享。对应总纲 §3.2 三个函数（`fetchTargetState` / `fetchHypePrices` / `placeDryRun`）与 §4.3「api 横切封装」。

职责单一：把「读 sodex 目标态」「读 hype 价格」「dry-run would-place 构造」三件 IO/换算工作收口到一个文件，纯逻辑层（mapping/sizing/reconcile/risk/recommend）只消费其返回的纯数据，不直接碰网络。

**dry-run 非完全离线**（总纲铁律）：dry-run 仍需联网——连 sodex 读目标真实仓位 + 保证金/杠杆，连 hype 读真实价格算名义/滑点参考价。**只有签名 + 提交订单这一步被省略**。

不臆造：sodex 读取复用 `service/sodex-watch` 范式（`httpGetJson` + `/api/v1/perps/accounts/{address}/state`），hype 读取复用 `service/HYPE-watch/api/index.mjs` 范式（`infoPost` + `clearinghouseState`/`meta`/`allMids`），共享限流退避两者均已有现成实现。

## 选定方案

落点（遵守 §3.5 命名 + feature-components-layout 单文件不建文件夹）：

```
service/HYPE-copy/api/index.mjs   ← 本横切唯一产物
```

结构（参照 `service/HYPE-watch/api/index.mjs` 同构）：

```
service/HYPE-copy/api/index.mjs
├─ installFetchProxy()          // 顶层 await，复用 service/lib/WARP（§3.4）
├─ ENVS                          // sodex gateway + hype info/allMids 双端点
├─ httpGetJson(url)              // sodex 读：复用 sodex-watch 范式（GET + parseJsonSafe + Retry-After）
├─ infoPost(env, body)          // hype 读：复用 HYPE-watch 范式（POST {type,...}）
├─ 共享限流（sharedRateLimitUntil / nextSharedBackoffMs / enterSharedRateLimit / resetSharedBackoff）
│                                // 两端各一组，照搬 HYPE-watch/api（§3.4 限流退避模式）
├─ fetchTargetState(env, sodexAddr) → 仓位[]含保证金/杠杆   // §3.2
├─ fetchHypePrices(env)         → { coin: midPx(string) }  // §3.2
├─ buildHypeAssetIndex(env)     // meta.universe 下标 → coin→{index, szDecimals}（下单参数必需）
└─ placeDryRun(leg, ctx)        → wouldPlaceLog            // §3.2，不签名不提交
```

> 真实下单（签名 + `ExchangeClient.order`）留接口口子但**不实现**：`placeDryRun` 内分支 `if (!dryRun) throw new Error("real submit 留待后续阶段")`，集中在一处便于后续阶段替换。

## 设计概要

### 数据来源（引用总纲 §3.2 + §3.4 复用件）

| 函数 | 数据来源 | 复用的现成实现 |
|---|---|---|
| `fetchTargetState` | sodex perps state | `service/sodex-watch/query.mjs` 的 `queryNext`：`GET {gateway}/api/v1/perps/accounts/{address}/state` → `data.P`（缩写字段 P=positions，已实测） |
| `fetchHypePrices` | hype `allMids` | `service/HYPE-watch/api/index.mjs` 的 `infoPost(env, { type:"allMids" })` |
| `buildHypeAssetIndex` | hype `meta` | `HYPE-watch/api` 的 `refreshMeta`：`infoPost(env,{type:"meta"})` → `universe[].{name,szDecimals}`，**额外取下标作 asset index** |
| `placeDryRun` | 上游传入 leg + 价格 | 纯本地构造，无网络 |

### `fetchTargetState` 返回契约

读 sodex perps state（复用 `queryNext` 取 `perps.P`），归一化为纯数据数组（字段名以实际 wire 为准，落地前先跑一次确认；杠杆/保证金缩写字段未知时 `--raw` 核对，不臆造）：

```ts
type TargetPosition = {
  symbol: string;       // sodex 标的符号（如 "ETH-USD"），交由 mapSymbol 映射
  szi: string;          // 带符号张数（多正空负），字符串保精度
  marginUsed: string;   // 该仓已用保证金（ratio 分母用，§3.3：只算可映射仓）
  leverage: number;     // 该仓杠杆（下单 size 折算 + 后续 updateLeverage 用）
  entryPx?: string;
};
```

- **只做归一化，不做映射 / 不算可映射性**——`mapSymbol`（01）与 ratio 分母过滤（02）是上游纯逻辑职责，本层不越界。
- 精度：金额/张数字段一律以 **string 透传**，禁止本层 `parseFloat` 运算（§3.3 精度规则；下单精度运算交 `process/precision.mjs`，`tool/format` 仅展示 / `isAddress`）。

### `fetchHypePrices` 返回契约

```ts
fetchHypePrices(env) → { [coin: string]: string }   // allMids 原样 coin→midPx 字符串
```

- dry-run 用途：算名义（size × midPx）判 `skip-mindust`（§2.2）、算滑点保护参考价。
- 不做任何换算/舍入，midPx string 原样返回。

### `buildHypeAssetIndex` 返回契约（下单参数必需）

总纲引用 blueprint §8.3：**asset 用数字 index（meta.universe 下标），SDK 不做 symbol→index 转换，需自建**。`HYPE-watch/api` 的 `refreshMeta` 只存了 `coin→szDecimals`，本层补存下标：

```ts
buildHypeAssetIndex(env) → Map<coin, { index: number; szDecimals: number }>
```

- `index` = `universe` 数组下标；`szDecimals` 决定 px/sz 字符串舍入位数（blueprint §8.3：`formatSize` 用 szDecimals，`formatPrice` 用 5 位有效数字 ROUND_DOWN）。
- 与 hype 价格一样走 6h 缓存（`META_REFRESH_MS`，与 HYPE-watch 一致），冷启动先刷一次。

### `placeDryRun` 返回契约（不签名不提交）

输入上游（03）算好的单腿 desired delta，**只构造 would-place 订单参数并返回日志对象**：

```ts
type Leg = { coin: string; isBuy: boolean; size: string; refPx: string; reduceOnly?: boolean };

placeDryRun(leg, { assetIndex, szDecimals, slippageBps, dryRun }) → WouldPlaceLog
```

按 blueprint §8.3 真实下单参数构造（仅构造，不发送）：

```ts
type WouldPlaceLog = {
  ts: number;
  action: "would-place";
  coin: string;
  order: {                     // 对齐 blueprint §8.3 order action 形状
    a: number;                 // asset index（数字）
    b: boolean;                // isBuy
    p: string;                 // 限价滑点保护价（refPx ± slippageBps，formatPrice 5 位有效数字 ROUND_DOWN）
    s: string;                 // size（formatSize szDecimals 位 ROUND_DOWN）
    r: boolean;                // reduceOnly
    t: { limit: { tif: "Ioc" } };  // IOC 限价（blueprint §8.3：市价无 IOC+滑点辅助，用 Ioc 限价自算滑点保护价）
  };
  dryRun: true;
};
```

- **p/s 字符串舍入** 用 `process/precision.mjs` 的 `formatPrice`/`formatSize`（ROUND_DOWN，自实现；§3.3：禁裸 `parseFloat`、禁用 `tool/format` 做精度）；舍入方向 ROUND_DOWN（防超额，对齐 sodex-web precision-calculation P3）。
- 真实下单口子：`dryRun !== true` 时本期 `throw`（占位），不实现签名/`ExchangeClient`。

### 限流退避（§3.4 复用 sodex-watch 限流模式）

两端 IO 各持一组模块级共享限流变量（照搬 `HYPE-watch/api`：`sharedRateLimitUntil` / `sharedBackoff` / `nextSharedBackoffMs`（秒级翻倍封顶 60s + ±20% jitter）/ `enterSharedRateLimit` / `resetSharedBackoff`）：

- sodex 端限流家族 `429/409`（sodex-watch 实测 409 亦为限流码）。
- hype 端限流 `429`（按 IP weight）。
- 命中限流 → `enterSharedRateLimit(waitMs)`（优先 `Retry-After`，无则指数退避）；成功 → `resetSharedBackoff()`。一期单目标单进程，QPS 天然低，但保留共享退避避免 burst 触限。

## 边界与约束

- **包含**：`fetchTargetState` / `fetchHypePrices` / `buildHypeAssetIndex` / `placeDryRun(dry-run 分支)`；sodex + hype 双端 `httpGetJson`/`infoPost`；WARP 代理；两端共享限流退避；meta universe index/szDecimals 缓存。
- **不包含**（后续 gated 阶段，仅留口子）：真实签名（EIP-712 phantom agent，blueprint §8.2）；`ExchangeClient.order` 提交；`updateLeverage` 真实调用；WS 订阅（一期对账走 REST 轮询，参照 watch 范式）。
- **不越界**：标的映射 / ratio 分母过滤 / desired 计算 / 校验门均为上游纯逻辑（01-03），本层只出归一化纯数据 + would-place 构造。
- 精度铁律（§3.3）：本层金额/size 字段 string 透传，下单运算/舍入交 `process/precision.mjs`（ROUND_DOWN，自实现），禁裸 `parseFloat`、禁用 `tool/format` 做精度。
- 字段名以实际 wire 为准：sodex `data.P` 内保证金/杠杆缩写字段落地前 `--raw` 核对确认，不臆造。

## 集成点

| 依赖 / 消费 | 路径 |
|---|---|
| 代理（§3.4） | `service/lib/WARP/index.mjs` → `installFetchProxy()` |
| 下单精度（§3.3） | `service/HYPE-copy/process/precision.mjs` → `formatPrice` / `formatSize`（ROUND_DOWN，自实现） |
| 地址校验（§3.4） | `service/tool/format.mjs` → `isAddress`（仅展示 / 地址校验，无精度运算） |
| sodex 读范式（§3.4） | `service/sodex-watch/query.mjs#queryNext` + `service/sodex-watch/api/index.mjs#httpGetJson` |
| hype 读 + 限流范式（§3.4） | `service/HYPE-watch/api/index.mjs#{infoPost,refreshMeta,共享限流组}` |
| hype SDK 契约 | `docs/hype/copy-trade-blueprint.md` §8.3/§8.4（order 参数 / clearinghouseState / allMids / meta） |
| 消费方 | 02 `computeDesired`（用 prices）；03 `decideLeg`（用 prices 算名义）/ `placeDryRun`（下单口子）；01 启动冷刷 meta/缓存 |

## 验收标准

- [ ] `fetchTargetState(env, addr)` 命中 sodex perps state，返回归一化 `TargetPosition[]`（含 symbol/szi/marginUsed/leverage，金额字段为 string）。
- [ ] `fetchHypePrices(env)` 返回 `{coin: midPx}` 原样 string，可供 02/03 算名义。
- [ ] `buildHypeAssetIndex(env)` 返回 `coin→{index, szDecimals}`，index 与 `meta.universe` 下标一致。
- [ ] `placeDryRun(leg, ctx)` 在 `dryRun=true` 时只返回 `WouldPlaceLog`（action="would-place"，order 形状对齐 blueprint §8.3，p/s 经 `process/precision.mjs` ROUND_DOWN 舍入），**不发起任何下单网络请求、不调用签名**。
- [ ] `placeDryRun` 在 `dryRun!==true` 时抛错占位（不实现真实提交），口子集中在一处。
- [ ] 两端命中限流（sodex 429/409、hype 429）触发共享退避；成功后退避计数清零；优先 `Retry-After`。
- [ ] fetch 全程走 WARP 代理（`HTTP_PROXY` 存在时生效）。
- [ ] 本层无裸 `parseFloat` 数值运算；金额/size 下单精度经 `process/precision.mjs`（ROUND_DOWN）处理，不用 `tool/format` 做精度。
- [ ] mock（总纲 §4.4）：`fetchTargetState`/`fetchHypePrices` 可被纯函数单测 drop-in 替换（返回固定 fixture）。

## 验收场景（Given/When/Then）

### 场景 1：dry-run 联网读真实数据 + would-place 构造（不提交）
- **Given** 单目标 sodex 地址持 ETH 多仓（保证金 4000，5x）；hype `allMids` 含 `ETH` midPx；02/03 算出 desired leg `{coin:"ETH", isBuy:true, size:"0.625", refPx:"<mid>"}`，`dryRun=true`，slippageBps 已配
- **When** 执行器对账调用 `fetchTargetState` + `fetchHypePrices` + `placeDryRun(leg, ctx)`
- **Then** `fetchTargetState` 返回含 ETH 仓（marginUsed="4000"、leverage=5 的 string/number）；`fetchHypePrices` 返回含 `ETH` midPx；`placeDryRun` 返回 `WouldPlaceLog`（action="would-place"，order.a=ETH 的 meta index、order.s="0.625" 按 szDecimals 舍入、order.p 为 refPx 加滑点保护后 ROUND_DOWN、order.t.limit.tif="Ioc"），**全程无下单 POST、无签名调用**

### 场景 2：真实提交口子被占位拒绝
- **Given** 同上 leg，但 `ctx.dryRun=false`（模拟后续阶段误触）
- **When** 调用 `placeDryRun(leg, { ...ctx, dryRun:false })`
- **Then** 抛错（一期未实现真实提交，口子集中占位），不发起任何下单/签名网络请求

### 场景 3：hype 读价命中限流共享退避
- **Given** `fetchHypePrices` 调 `infoPost(allMids)` 返回 HTTP 429（带 `Retry-After: 2`）
- **When** IO 层捕获限流错误
- **Then** 调 `enterSharedRateLimit`（waitMs 取 Retry-After=2000）推进 `sharedRateLimitUntil`；下次成功调用后 `resetSharedBackoff` 清零；退避遵循秒级翻倍封顶 60s + ±20% jitter（照搬 HYPE-watch 范式），不臆造新限流逻辑
