# Spec 01 · 配置加载 + 标的映射

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本子单元自身，**冲突以总纲为准**。
> 依赖：总纲 §4 Phase0（类型 + targets schema）。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本阶段。

---

## 背景与目的

本子单元落地总纲 §8 拓扑中的「阶段 1」，提供执行器最底层的两个纯函数能力：

1. **配置加载** `loadTargets(path)`——读取 `targets.json`，强制单目标硬限制（总纲 §3.1：`targets.length>1 → 拒绝启动`），向上游返回 `{ tgToken, target }`，是 `main.mjs` 启动的第一道关卡。
2. **标的映射** `mapSymbol(srcSymbol, srcPlatform)`——按信号源平台分流（总纲 §3.2）：**sodex 源走映射表（跨所）**，把 sodex 标的（如 `ETH-USD`）规约为 hype coin（`ETH`），hype 无对应的股票/商品 perp（PLTR/USTECH/XAUT/COPPER 等）返回 `null`；**hype 源同所直通**（coin→coin，仅校验 hype universe 有该 coin，无需映射表）。不可映射时下游据此走 `skip-unmappable`（总纲 §2.2）且不计入 ratio 分母（总纲 §3.3）。

对应总纲 §3.2 中标记「消费方 01」的两个函数签名，本文实现之，**不重定义签名**。

## 选定方案

落点（遵守 feature-components-layout：单文件不建文件夹）：

| 文件 | 内容 |
|---|---|
| `service/HYPE-copy/process/mapping.mjs` | `mapSymbol(srcSymbol, srcPlatform)`（sodex 映射表 / hype 同所直通）+ 配置加载 `loadTargets` + targets 默认值填充。两者皆纯逻辑、无副作用（`loadTargets` 仅读文件 + 校验），同一阶段产物合并一文件，避免为单函数过度拆文件。 |
| `service/HYPE-copy/test/domain.test.mjs` | 本阶段纯函数单测（与 sodex-watch 同构，Node 22 内置 `node:test`，零依赖；后续阶段追加 case 到同一文件）。 |
| `service/HYPE-copy/targets.json` | 目标配置样例（单目标），供 `loadTargets` 读取与手测。 |

> 复用：sodex symbol 拆基础币逻辑与 `service/sodex-watch/process/parse.mjs` 的 `baseCoin(symbol)`（`split(/[-/]/)[0]`）同源；本件独立实现 `mapSymbol`（含大小写归一 + 不可映射判定），不跨 service 直接 import，保持 HYPE-copy 自洽。

## 设计概要

### 数据来源

- `targets.json` 结构遵循总纲 §3.1 `Target` schema 与文件根 `{ tgToken, targets: Target[] }`，本件不重定义字段。
- 默认值（总纲 §3.1 注释）：`initialDeployPct=0.5`、`maxDeployPct=0.9`、`sizeMultiplier=1`、`dryRun=true`（一期恒真）。`loadTargets` 对缺省字段填默认，保证下游 02/03 拿到完整 `Target`。

### `loadTargets(path) → { tgToken, target }`

总纲 §3.2 签名：`(path) → {tgToken, target}`；`>1 目标抛错`。

逻辑顺序（早返回，guard 优先）：

1. 读文件 + `JSON.parse`；解析失败 → 抛 `Error("targets.json 解析失败: ...")`。
2. 校验根结构：`targets` 非数组或为空 → 抛 `Error("targets.json 必须包含非空 targets 数组")`。
3. **单目标硬限制**：`targets.length > 1` → 抛 `Error("一期仅支持单目标（N:1 净额收敛未实现）")`（文案对齐总纲 §7 场景 3）。
4. 取 `target = targets[0]`，校验必填：`id` 非空、`source.address` 通过 `isAddress`、`exchange === "hype"`；不满足 → 抛对应 `Error`。
5. 填默认值（见上）后返回 `{ tgToken, target }`。

> `tgToken` 取文件根字段；缺失不抛错（推送为后续阶段，dry-run 可空），由 04 阶段决定降级。

### `mapSymbol(srcSymbol, srcPlatform) → hypeCoin | null`

总纲 §3.2 签名：`(srcSymbol, srcPlatform) → hypeCoin | null`；消费方 01/02/03。按 `srcPlatform`（`"sodex"` / `"hype"`）分流：

**公共前置**：

1. 入参非字符串 / 空白 → 返回 `null`。
2. 取基础币：`String(symbol).split(/[-/]/)[0]`，去空白、转大写得 `coin`（如 `eth-usd` / `ETH/USDC` → `ETH`）。

**sodex 源（跨所，走映射表）**：

3. 命中**不可映射集合** `UNMAPPABLE`（股票/商品 perp）→ 返回 `null`。
4. 否则返回 `coin`（hype perp 以基础币名作 coin，等比 1:1 名称映射）。

**hype 源（同所，直通）**：

3. coin→coin 直通——hype 信号源与执行所同为 hype，标的天然一致，**无需映射表 / 黑名单**。
4. 仅校验 hype universe 有该 coin（coin 存在性校验；本期可由 api 横切 `buildHypeAssetIndex` 的 universe 提供，未接入前直通返回 `coin`，存在性校验为后续 hype `meta` 接入增强）；不存在 → 返回 `null`。

`UNMAPPABLE` 常量（顶部命名常量，对齐 clean-code，仅 sodex 源用）：至少含总纲与原始设计点名的 `PLTR` / `USTECH` / `XAUT` / `COPPER`；以集合形式声明，便于后续扩充。命中即「hype 无对应标的」。

> 设计取舍：sodex 源一期采用「基础币名直通 + 黑名单排除不可映射」而非维护全量白名单——hype 加密 perp 命名与 sodex 基础币高度一致，黑名单覆盖已知少数例外即可，避免漏配新上线币种被误跳过。hype 源同所直通无需任何映射表。白名单化 / hype universe 实时存在性校验为后续阶段（接 hype `meta`）的可选增强，本期 sodex 黑名单 + hype 直通即可。

### 场景与变体

| 维度 | 场景 A：sodex 可映射 | 场景 B：sodex 不可映射 | 场景 C：hype 同所直通 | 场景 D：非法输入 |
|---|---|---|---|---|
| 输入 | `("ETH-USD","sodex")` / `("BTC/USDC","sodex")` | `("PLTR-USD","sodex")` / `("XAUT-USD","sodex")` | `("ETH","hype")` / `("BTC","hype")` | `(null,*)` / `("",*)` / 非字符串 |
| `mapSymbol` 返回 | `ETH` / `BTC` | `null` | `ETH` / `BTC`（universe 有则直通，无则 `null`） | `null` |
| 下游（总纲 §2.2） | 进 desired 计算 | `skip-unmappable`，不计 ratio 分母 | 进 desired 计算 | 视为不可映射跳过 |

| 维度 | 单目标 | ≥2 目标 | 结构非法 |
|---|---|---|---|
| `loadTargets` | 返回 `{tgToken, target}`（默认值已填） | 抛错「一期仅支持单目标」 | 抛对应校验 Error |

## i18n 文案

不涉及（service 层，无前端 i18n）。

## 边界与约束

- 包含：`loadTargets`（读取 + 单目标校验 + 默认值填充）、`mapSymbol(srcSymbol, srcPlatform)`（sodex 映射表 + hype 同所直通 + 基础币归一 + 不可映射判定）、本阶段纯函数单测、`targets.json` 样例。
- 不包含：ratio / desired / 校验门（02/03）；api 横切 `fetchTargetState` / `fetchHypePrices`（总纲 §4.3，横切件）；推送 / 日志（04）；hype `meta` 实时 coin 存在性校验（后续阶段，hype 源未接入前直通）。
- 约束：纯函数，禁裸 `parseFloat` 运算（本件不做数值运算，仅字符串归一与结构校验，故无精度风险）；`mapSymbol` 对任意非法入参必须安全返回 `null`，不抛错（下游靠返回值分流，不靠异常）。

## 集成点

- 上游：总纲 §3.1 `Target` 类型、§4 Phase0 schema。
- 下游消费：`02-sizing-recommend.md`（`mapSymbol` 过滤可映射仓算 ratio 分母）、`03-reconcile-dryrun.md`（`mapSymbol` 在 `decideLeg` 判 `skip-unmappable`）、`main.mjs`（`loadTargets` 启动校验）。
- 复用参照：`service/sodex-watch/process/parse.mjs` 的 `baseCoin`、`service/tool/format.mjs` 的 `isAddress`。

## 验收标准

- [ ] sodex 源：`mapSymbol("ETH-USD","sodex") === "ETH"`；`mapSymbol("BTC/USDC","sodex") === "BTC"`；大小写混入仍归一为大写 coin。
- [ ] sodex 源：`mapSymbol("PLTR-USD","sodex") === null`；`USTECH` / `XAUT` / `COPPER` 同样返回 `null`。
- [ ] hype 源同所直通：`mapSymbol("ETH","hype") === "ETH"`（universe 有则直通；接入 universe 校验后不存在的 coin 返回 `null`）。
- [ ] `mapSymbol(null,*)` / `mapSymbol("",*)` / `mapSymbol(123,*)` 均返回 `null`，不抛错。
- [ ] `loadTargets` 读单目标 `targets.json` 返回 `{ tgToken, target }`，且 `target` 含填充后的默认值（`initialDeployPct=0.5` 等）。
- [ ] `loadTargets` 读含 2 个目标的配置 → 抛错，错误信息含「单目标」。
- [ ] `loadTargets` 对缺 `source.address`（或非法地址）/ 缺 `id` / `exchange!=="hype"` 的配置抛对应校验 Error。
- [ ] `node --test service/HYPE-copy/test/domain.test.mjs` 全绿。

## 验收场景（Given/When/Then）

### 场景 1：sodex 源标的映射命中与不命中
- **Given** sodex 目标同时持有 `ETH-USD`、`BTC/USDC`、`PLTR-USD`、`XAUT-USD` 四个仓位标的
- **When** 对每个 symbol 调用 `mapSymbol(symbol, "sodex")`
- **Then** `ETH-USD→"ETH"`、`BTC/USDC→"BTC"`（可映射，进下游 desired）；`PLTR-USD→null`、`XAUT-USD→null`（不可映射，下游走 `skip-unmappable` 且不计入 ratio 分母，对齐总纲 §2.2 / §3.3）

### 场景 1b：hype 源同所直通
- **Given** hype 目标持有 `ETH`、`BTC` 仓位（信号源与执行所同为 hype）
- **When** 对每个 coin 调用 `mapSymbol(coin, "hype")`
- **Then** `ETH→"ETH"`、`BTC→"BTC"`（同所直通，无需映射表，进下游 desired）；coin 不在 hype universe 时返回 `null`（接入存在性校验后）

### 场景 2：单目标硬限制拒绝启动
- **Given** `targets.json` 配置 `targets` 数组含 2 个目标
- **When** `main.mjs` 启动调用 `loadTargets(path)`
- **Then** 抛 `Error`，信息含「一期仅支持单目标」，启动中止、不进入对账（对齐总纲 §7 场景 3）

### 场景 3：单目标 + 默认值填充
- **Given** `targets.json` 单目标，仅显式写 `id` / `source.address` / `exchange:"hype"`，省略 `initialDeployPct` 等可选项
- **When** 调用 `loadTargets(path)`
- **Then** 返回 `{ tgToken, target }`，`target.initialDeployPct===0.5`、`target.maxDeployPct===0.9`、`target.sizeMultiplier===1`、`target.dryRun===true`，下游 02/03 拿到完整 `Target`
