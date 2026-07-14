# watch 仓位持久化格式修复（数据层）

## 背景与目的

sodex-watch 的 `saveLastPositions` 写 `coin`/`dir` 字段，但 `parseWsPosition` 产出的是 `symbol`/`posSide`（没有 `coin`/`dir`）。持久化文件实际存储的内容为 `coin:"undefined"` / `dir:"undefined"`。

`diffPositions` 用 `baseCoin(p.symbol):positionDirection(p)` 生成 key，读取的是 `symbol`/`posSide`。两套字段不一致 → 持久化恢复后的 key 永远为 `"undefined:LONG"` → 与 WS 新帧的 `"XAUt:LONG"` 不匹配 → 每次重启/重连后 `diffPositions` 都返回假 `OPENED` 事件。

HYPE-watch 不受格式错位影响（HYPE 的 `parsePositions` 原生产出 `coin`/`dir`，与持久化一致），但共用 `lastPositionsStore.mjs`，统一存储 schema 后两端均受益。

**目标**：
1. sodex `parseWsPosition` 补充 `coin`/`dir` 别名（供持久化写入）
2. `loadLastPositions` 同时返回 `symbol`/`posSide`（从 coin/dir 反推，供 sodex `diffPositions` 消费）和 `coin`/`dir`（供 HYPE `diffPositions` 消费）
3. `loadLastPositions` 过滤旧文件中不可识别的条目（过渡期自愈）

## 选定方案

**方案 B（修正）**：统一持久化存储为 `coin`/`dir`/`size`，load 时同时补全 `symbol`/`posSide`

- sodex 端：`parseWsPosition` 加 `coin`/`dir` 别名
- `loadLastPositions`：读 `coin`/`dir` → 返回 `{symbol: coin+"-USD", posSide: dir, coin, dir, size}`（两端 diffPositions 各自取需要的字段）
- `saveLastPositions` 保持写 `coin`/`dir`/`size`（不变）

## 设计概要

### 1. sodex `parse.mjs` — `parseWsPosition` 加 `coin`/`dir` 别名

```js
export function parseWsPosition(p) {
  const s = String(p.s ?? p.symbol ?? "?");
  const ps = String(p.ps ?? p.positionSide ?? "");
  return {
    symbol: s,
    posSide: ps,
    size: String(p.sz ?? p.size ?? "0"),
    // ... 其他字段不变 ...
    coin: baseCoin(s),                                        // 新增：供 saveLastPositions 持久化用
    dir: positionDirection({ posSide: ps, size: String(p.sz ?? p.size ?? "0") }),  // 新增
  };
}
```

### 2. `lastPositionsStore.mjs` — `loadLastPositions` 返回完整字段

```
load 流程:
  读取 JSON → positions 数组
  逐条检查:
    - coin/dir 有效（非 undefined/非 "undefined"/非 ""）→ 直接使用
      返回 { symbol: coin+"-USD", posSide: dir, coin, dir, size }
    - coin/dir 无效但 symbol 有效（旧格式防御，存量文件不存在此格式）
      → 返回 { symbol, posSide, coin: baseCoin(symbol), dir: positionDirection(...), size }
    - 两者都无效 (coin="undefined") → 过滤掉（过渡期自动愈合）
```

**关键**：加载后的数据结构同时包含 `symbol`/`posSide` 和 `coin`/`dir`，sodex `diffPositions` 用前者，HYPE `diffPositions` 用后者，两端都能正确生成 key。

### 3. `saveLastPositions` 保持不变

当前已写入 `coin`/`dir`/`size`。sodex 端 `parseWsPosition` 加 `coin`/`dir` 别名后，写入变为正确值。HYPE 端本身就是正确的。

### 4. 不需改动的文件

- `service/sodex-watch/process/parse.mjs` — `diffPositions` key 函数（L142）不变，始终读 `symbol`/`posSide`
- `service/HYPE-watch/process/parse.mjs` — `diffPositions` key 函数（L157）不变，始终读 `coin`/`dir`
- `service/HYPE-watch/process/parse.mjs` — `parsePositions` 已产出 `coin`/`dir`，不改

## 边界与约束

| 项 | 处理 |
|----|------|
| 包含 | sodex `parseWsPosition` 加 coin/dir 别名、`lastPositionsStore.mjs` load 返回完整字段 + 兼容 + 过滤逻辑 |
| 不包含 | HYPE `parse.mjs` 改动（coin/dir 已有）、watcher 逻辑改动（Spec B）、reportGate 改动、sodex/HYPE `diffPositions` 改动 |
| 过渡期 | 旧文件 coin:"undefined" 条目被过滤 → `loadLastPositions` 返回 `[]` → watcher 等效首次启动（1 周期后正确数据写回，自愈） |
| 部署影响 | 过滤后等效首次启动 → watcher 首周期不发事件（仅 console），下一个仓位变化立即恢复正常。对现网 VPS 影响：重启后每个地址首周期无 TG 事件推送 |

## 集成点

| 文件 | 改动 |
|------|------|
| `service/sodex-watch/process/parse.mjs` | `parseWsPosition` 加 `coin`/`dir` 字段 |
| `service/tool/lastPositionsStore.mjs` | `loadLastPositions` 返回 `{symbol, posSide, coin, dir, size}` + 旧格式兼容 + 过渡期过滤 |

## 验收标准

- [ ] sodex `parseWsPosition` 产出含 `coin`/`dir` 字段
- [ ] `loadLastPositions` 返回 `{symbol, posSide, coin, dir, size}`（两端 diffPositions 各自取需要的字段）
- [ ] `loadLastPositions` 过滤 `coin:"undefined"` 的条目
- [ ] 现有单测不退化（sodex 21 + HYPE 14 + lastPositionsStore 5）
- [ ] `node --check` 全通过

## 验收场景

### 场景 1：新格式读写（端到端）
- **Given** sodex-watch 运行中，`this.positions` 含有 `{symbol:"XAUt-USD", posSide:"LONG", size:20, coin:"XAUt", dir:"LONG"}`
- **When** `saveLastPositions` 写入（`{coin:"XAUt", dir:"LONG", size:20}`），重启后 `loadLastPositions` 读回
- **Then** 返回 `[{symbol:"XAUt-USD", posSide:"LONG", coin:"XAUt", dir:"LONG", size:20}]`

### 场景 2：过渡期过滤
- **Given** 持久化文件为 `{positions:[{coin:"undefined", dir:"undefined", size:20}]}`
- **When** `loadLastPositions` 读取
- **Then** 返回 `[]`（过滤不可识别条目），等效首次启动

### 场景 3：混合文件
- **Given** 持久化文件含 `[{coin:"undefined", dir:"undefined", size:10}, {coin:"XAUt", dir:"LONG", size:20}]`
- **When** `loadLastPositions` 读取
- **Then** 返回 `[{symbol:"XAUt-USD", posSide:"LONG", coin:"XAUt", dir:"LONG", size:20}]`（仅保留有效条目）

### 场景 4：HYPE 端数据不变
- **Given** HYPE-watch 写入 `{coin:"HYPE", dir:"SHORT", size:100}`
- **When** `loadLastPositions` 读取
- **Then** 返回 `[{symbol:"HYPE-USD", posSide:"SHORT", coin:"HYPE", dir:"SHORT", size:100}]`，HYPE `diffPositions` 用 `coin`/`dir` 生成 key `"HYPE:SHORT"` ✅

### 场景 5：sodex 端 key 匹配
- **Given** sodex-watch 从持久化恢复 `[{symbol:"XAUt-USD", posSide:"LONG", ...}]`，WS 新帧含 `{symbol:"XAUt-USD", posSide:"LONG", size:20}`
- **When** `diffPositions(lastPositions, positions)` 比较
- **Then** key 均为 `"XAUt:LONG"` → 无 diff → 不产假 OPEN ✅
