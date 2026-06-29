# HYPE-copy 多币种跟单上限控制

> 状态：ready  
> 日期：2026-06-29  
> 关联：`.claude/kit/spec/auto-copy-trade/` / `docs/copy/hype.md`

---

## 背景与目的

当前跟单使用**全局等比缩放**：`ratio = (avail × deployPct) / Σ目标保证金`，所有币种共享同一 ratio。实测问题：

- **小账户放大**：目标保证金 $12.52 → ratio 1997% → 微小仓位被放大 20 倍，$12 仓位 → 跟单 $250
- **大户截断**：目标保证金 $12,653 → ratio 2% → LIT 单仓仍需 $1,250，超 maxPositionPct
- **部署跟踪缺失**：`main.mjs:119` 硬编码 `currentDeployedNotional: "0"`，multi-coin 时部署上限形同虚设

目标：$500 本金最多跟 2 币，单币 ≤ $350 名义，总部署 ≤ $450。

## 选定方案

方案 A：per-coin cap + 正确跟踪。每币独立计算 ratio，上限截断，部署累积跟踪。

核心理由：改动 ~40 行，不破坏现有 dataflow，风险低（dry-run）。

## 设计概要

### 1. 每币独立 ratio

```
每币 ratio = min(
    maxRatio,                                                    // 新增：上限封顶
    (avail × initialDeployPct) / targetMappableMargin           // 沿用：全局锚定
)
```

示例（8EC0，maxRatio=1.0）：
```
ratio = min(1.0, 250/12.52) = 1.0（封顶）
跟单 = $63 × 1.0 = $63 名义 ✅
```

### 2. Per-coin notional cap

在 `computeDesired` 内截断：
```
mirrorNotional = min(目标名义 × ratio[coin], maxPosNotional)
maxPosNotional = avail × maxPositionPct  // $500 × 0.7 = $350
```

返回 `{ coin, size, mirrorNotional }`。

### 3. 部署跟踪

```
state.deployedByCoin: Map<coin, notional>

currentDeployedNotional = Σ deployedByCoin.values()  // 替代硬编码 0
```

| 事件 | 操作 |
|------|------|
| 新币 place | deployedByCoin.set(coin, notional) |
| 平仓（close 检测触发） | deployedByCoin.delete(coin) |
| restart | Map 清空（重新锚定） |

### 4. maxCoins 限制

```
mappable 按目标名义降序 → slice(0, maxCoins)
超出币种 → push ⛔ {coin} 未跟——已达 {maxCoins} 币上限
```

最终排序：部署满 > maxCoins 超出 > 正常。

### 5. 配置

```json
{
  "maxRatio": 1.0,
  "maxCoins": 2,
  "maxPositionPct": 0.7,
  "maxDeployPct": 0.9,
  "initialDeployPct": 0.5
}
```

## 边界与约束

| 项 | 决策 |
|----|------|
| 重新锚定 | **不做**（本期），avail 变化 > 10% 不自动重算 ratio，手动 restart 触发 |
| 被拦币重试 | **不做**（本期），首次 skip-maxpos 后 lastWouldHold 记录 → 下轮 delta=0 不再评估 |
| ratio 精度 | 沿用 precision.mjs Decimal，封顶比较用 `min` |
| deployByCoin 生命周期 | restart 清空；SIGTERM 不持久化 |
| maxRatio=1.0 含义 | 跟单不超过 1:1，即不放大目标仓位 |

## 集成点

| 文件 | 行 | 改动 |
|------|-----|------|
| `sizing.mjs` | L19-33 | `computeDesired` 签名改为 `(positions, ratios, prices)`，内部 per-coin cap |
| `risk.mjs` | L36-38 | 无改动（已支持 `currentDeployedNotional` 形参） |
| `main.mjs` | L119 | `currentDeployedNotional` 从 `deployedByCoin` 计算 |
| `main.mjs` | L59-64 | mappable 按名义排序 + maxCoins 过滤 + 超出告警 |
| `main.mjs` | L35-42 | state 加 `deployedByCoin` Map |
| `templates.mjs` | — | 新增 `skip-maxcoins` 模板行 |
| `targets.example.jsonc` | — | 新增 `maxRatio` / `maxCoins` |
| `targets.json` | — | 同上 |

## 验收标准

- [ ] `computeDesired` 每币返回截断后的 `{ coin, size, mirrorNotional }`
- [ ] `currentDeployedNotional` 每轮从 `state.deployedByCoin` 计算（非硬编码 0）
- [ ] maxRatio 封顶生效（ratio > 1.0 → cap to 1.0）
- [ ] maxCoins 限制生效（第 3 币 push 告警 `⛔ {coin} 未跟——已达 {maxCoins} 币上限`）
- [ ] 两币部署总和 ≤ avail × maxDeployPct（$450），超出币推送 `⛔ {coin} 部署满` 告警
- [ ] 平仓释放已部署额度（deployedByCoin.delete）
- [ ] 单币名义 ≤ avail × maxPositionPct（$350）
- [ ] 单元测试覆盖上述场景

## 验收场景

### 场景 1：两币部署满（Happy Path）
- **Given** 目标持有 wBTC(40x, $72,106 名义) + wETH(25x, $71,098 名义)，总保证金 $4,647，maxCoins=2，maxDeployPct=0.9，maxPositionPct=0.7，avail=$500
- **When** reconcileOnce 执行第一轮
- **Then** BTC 跟单 $350 名义 ($8.75 保证金)，ETH 因部署满（$350+$350=$700 > $450）被拦截，push ⛔ ETH 部署满

### 场景 2：小账户 maxRatio 封顶
- **Given** 目标持有 ARB(5x, $63 名义, $12.52 保证金)，maxRatio=1.0，maxPositionPct=0.7，avail=$500
- **When** reconcileOnce 执行
- **Then** ratio 从 1997% 封顶至 100%，跟单 $63 名义 ($12.52 保证金)，不超过单币上限 $350 ✅

### 场景 3：第三币告警
- **Given** 目标持有 BTC + ETH + SOL，maxCoins=2，排名 SOL 名义第三
- **When** reconcileOnce 执行
- **Then** SOL 不在 desired 中，push ⛔ SOL 未跟——已达 2 币上限

### 场景 4：平仓释放额度
- **Given** 已跟 BTC $350 名义，deployedByCoin={BTC: $350}
- **When** 目标平仓 BTC（BTC 从 mappable 消失）
- **Then** deployedByCoin 移除 BTC → currentDeployedNotional 归零 → 下轮可跟新币
