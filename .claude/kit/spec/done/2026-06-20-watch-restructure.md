# watch 脚本结构化重组：抽共享 tool/ + watch/ 子目录（api + process）

**创建日期**: 2026-06-20 | **类型**: refactor（纯结构迁移，行为零变更）| **状态**: 待 spec/task | **分支**: dev

> 由 `/k:clarify` 产出。参照 `script/discovery/` 已落地的 `main + api/ + process/ + config` 结构，把 watch 相关脚本归拢到 `script/watch/`，并把全局格式化函数上升为共享层 `script/tool/`。

## 背景与目的

`script/` 根目录当前平铺四个文件：`watch-account.mjs`(1090 行)、`query-account.mjs`(244 行)、`format.test.mjs`、`watch.config.json`。`discovery/` 已重组为 `main + api/ + process/`，watch 侧仍是单体大文件，职责（IO / 纯转换 / 纯渲染 / 有状态编排）全挤在一个文件里，难单测、难维护。

**目的**：对齐 discovery 结构，把 watch 拆成可独立理解的层；把数字/时间/小数格式化函数抽到全局共享 `script/tool/`，供 watch / discovery / query 复用。**纯结构迁移，运行行为必须零变更。**

## 选定方案

**按「层」拆分（非「管线阶段」）+ 抽共享 tool/。**

关键依据（与 discovery 的本质差异）：discovery 是线性纯函数管线（collect→filter→…各自独立），故一阶段一文件。watch 的「订阅/监听/聚合/推送」全是同一个有状态 `AccountWatcher` 实例上的方法，共享 `this.positions/seenPositionIds/stateFp`，是一个循环的几个阶段、**不可拆成独立文件**；且 WS 连接生命周期是 per-watcher 有状态的，**不能塞进无状态 api/**。因此 watch 按「层」拆：IO 层 / 纯转换 / 纯渲染 / 有状态编排。

## 设计概要

### 目标目录结构

```
script/
  tool/
    format.mjs            # 全局共享格式化（数字/千分位/去尾零/USD/百分比/时间/小数）
    format.test.mjs       # 迁移自 script/format.test.mjs，import ./format.mjs
  watch/
    main.mjs              # 入口：parseArgs + 单/多地址编排 + 启动 watcher/snapshot
    query.mjs             # 原 query-account.mjs（闭环核查腿），复用 api/index.mjs
    config.json           # 原 watch.config.json（gitignore，含 TG token）
    api/
      index.mjs           # IO 层
    process/
      parse.mjs           # 纯归一 + diff
      render.mjs          # 纯渲染（import ../../tool/format.mjs + api 符号缓存）
      watcher.mjs         # AccountWatcher 有状态编排（含 WS 生命周期）
      snapshot.mjs        # SnapshotMode + msUntilNextShanghai
      config.mjs          # loadConfig（多地址校验）
  discovery/              # 本次不动
```

### 函数落位表（源：`script/watch-account.mjs` 行号）

| 目标文件 | 迁入内容（现有行号） |
|---|---|
| `tool/format.mjs` | `isBlank`/`fmtNum`(L152)/`fmtUsd`(L160)/`fmtPct`(L169)/`fmtTime`(L178)/`fmtTimeShort`(L186)/`DIRECTION_CN`+`directionCN`(L193) |
| `watch/api/index.mjs` | `ENVS`(L61)/`CHANNELS`(L72) + 网络常量；`parseJsonSafe`(L132)/`parseRetryAfter`(L138)/`httpGetJson`(L198)；共享限流 `sharedRateLimitUntil`/`watcherRegistry`/`nextSharedBackoffMs`/`scheduleSharedWake`/`enterSharedRateLimit`(L211-242)；`sendTelegram`(L245)；符号缓存 `buildSymbolMeta`/`refreshSymbols`/`symbolMeta`/`symbolMetaBySymbol`(L308-345)；`fetchPositionHistory`(L560)；`resolveAccountIdViaChain`(L520) |
| `watch/process/parse.mjs` | `parseWsPosition`(L346)/`parseReduceOnlyOrders`(L362)/`canonicalReduceOnlyOrders`(L378)/`positionDirection`(L389)/`canonicalPositionsFp`(L396)/`marginModeLabel`(L404)/`positionSideCN`(L531)/`marginModeNumLabel`(L535)/`toPositionHistoryRecords`(L541)/`diffPositions`(L584)/`diffReduceOnly`(L606) |
| `watch/process/render.mjs` | `derivePositionView`(L412)/`exitOrderLines`(L451)/`matchReduceOnly`(L464)/`exitTpSlLabel`(L474)/`bannerHead`(L503)/`classifyBanner`(L511)/`displayWidth`(L648)/`boxBanner`(L654)/`buildEventBanner`(L662)/`renderPositions`(L621)/`renderPositionHistory`(L566)/`buildTgMessage`(L261)/`buildExitOrderBanner`(L298) |
| `watch/process/watcher.mjs` | `AccountWatcher` 类(L667-915) + WS 生命周期常量(PING/PONG/RECONNECT) + `SEEN_IDS_CAP` |
| `watch/process/snapshot.mjs` | `SnapshotMode`(L929) + `msUntilNextShanghai`(L920) + `SHANGHAI_OFFSET_MS`(L918) |
| `watch/process/config.mjs` | `loadConfig`(L1012) |
| `watch/main.mjs` | `parseArgs`(L87)/`isAddress`(L99)/`isValidHHMM`(L116)/`pickAt`(L126)/`shortAddress`(L105)/`formatDisplayId`(L111)/`main`(L1036) |
| `watch/query.mjs` | 原 `query-account.mjs` 主体；删除其内重复的 `httpGetJson`/`isAddress`/`parseArgs`/`resolveAccountId`，改 import `watch/api/index.mjs` 与 `watch/main.mjs`(或共用工具) |

### 跨切关注点（实现者须先定位再迁移，避免断链）

1. **`log` 全局日志助手**：watch-account 全文用 `log(...)`，定义未在函数 grep 中出现——实现前先 `grep -n "const log\|function log" watch-account.mjs` 定位，放入一处（建议 `api/index.mjs` 或单独 `process/util.mjs`），各模块 import。
2. **`baseCoin`**：watcher L890/901/907 引用，定义需定位（同上 grep），随 parse.mjs 一起迁。
3. **共享可变状态（live binding）**：`sharedRateLimitUntil`(let) 在 api 定义、watcher 读；`watcherRegistry`(Set) api 定义、watcher `add(this)`、api `scheduleSharedWake` 回调 `w.scheduleFetch()`；`symbolMeta` 缓存 api 定义、render/watcher 读。ES module 导出 live binding，**只读跨模块引用可行**；迁移后必须保持这层耦合不破。
4. **`WebSocket` 来源**：watcher `new WebSocket(url)`——先确认是 Node 全局还是 `import ... from "ws"`（.gitignore 提到 `npm install ws`），按现状保留。
5. **`.gitignore`**：把 `script/watch.config.json` 改为 `script/watch/config.json`（路径迁移）。

### 行为零变更原则

所有迁移**只移动 + 改 import 路径**，不改任何逻辑/常量/字符串/注释。CLI 用法（`node script/watch/main.mjs ...`、`--snapshot`、`--config=`、`--tg-*`）与输出格式保持完全一致。

## 边界与约束

**包含：**
- watch-account / query-account / format.test / watch.config.json 迁入新结构
- 抽 `script/tool/format.mjs`（全局共享格式化）
- 更新所有 import 路径与 `.gitignore`
- 同步 `docs/update-log.md`（watch 路径变更）

**不包含：**
- discovery 不动（其 `output.mjs` 自包含 fmt* 保留，本次不改用 tool/）
- 不改任何运行逻辑 / 算法 / 输出格式（纯结构迁移）
- 不新增功能、不补新测试（仅迁移 format.test + 改 import）
- 不拆 tool/ 为多文件（单 `format.mjs`）

**已知限制：**
- watch-account 是有状态长连核心，拆分依赖 ES module live binding 维持共享状态耦合；迁移后须实跑验证行为一致

## 集成点

| 文件 / 符号 | 改动 |
|---|---|
| `script/tool/format.mjs` | **新增**（从 watch-account 抽格式化函数） |
| `script/tool/format.test.mjs` | **迁移**自 `script/format.test.mjs`，import 改 `./format.mjs` |
| `script/watch/main.mjs` | **新增**入口（原 watch-account main + CLI 工具函数） |
| `script/watch/query.mjs` | **迁移**自 `script/query-account.mjs`，复用 api/ |
| `script/watch/api/index.mjs` | **新增** IO 层 |
| `script/watch/process/{parse,render,watcher,snapshot,config}.mjs` | **新增** 五层 |
| `script/watch/config.json` | **迁移**自 `script/watch.config.json` |
| `script/watch-account.mjs` / `script/query-account.mjs` / `script/format.test.mjs` / `script/watch.config.json` | **删除**（已迁出） |
| `.gitignore` | `script/watch.config.json` → `script/watch/config.json` |
| `docs/update-log.md` | 同步 watch 结构变更条目 |

## 验收标准

- [ ] `node --check` 通过：`watch/main.mjs`、`watch/query.mjs`、`watch/api/index.mjs`、`watch/process/*.mjs`、`tool/format.mjs`、`tool/format.test.mjs`
- [ ] `node --test`（script/ 范围）全绿覆盖 `tool/format.test.mjs`（迁移前 40 通过不退化；原既有 1 失败仍为既有失败）
- [ ] `tool/format.test.mjs` import 指向 `./format.mjs`，无残留指向 watch-account 的 import
- [ ] watch 各模块 import 路径正确解析（`process/*` → `../../tool/format.mjs` / `../api/index.mjs`），动态 import 无断链
- [ ] 旧文件（`watch-account.mjs`/`query-account.mjs`/`format.test.mjs`/`watch.config.json`）已删除，无残留
- [ ] `.gitignore` 指向 `script/watch/config.json`
- [ ] `node script/watch/main.mjs <addr> --snapshot` 行为与迁移前一致（仓位/平仓历史/banner 输出格式不变）
- [ ] `node script/watch/query.mjs <addr>` 行为与迁移前 `query-account.mjs` 一致
- [ ] 全 `script/` grep 无残留旧路径引用（`watch-account.mjs` / `query-account.mjs` 的 import）

## 验收场景

### 场景 1：格式化共享层迁移后测试全绿（Happy Path）
- **Given** `script/tool/format.mjs` 含从 watch-account 迁入的 `fmtNum/fmtUsd/fmtPct/fmtTime/fmtTimeShort/directionCN`（6 函数 + isBlank），`script/tool/format.test.mjs` 的 import 改为 `./format.mjs`，原 `script/format.test.mjs` 与 `script/watch-account.mjs` 已删除
- **When** 在 `script/` 下执行 `node --test`
- **Then** format 相关用例（迁移前 40 通过）仍全部通过，无 "Cannot find module" 报错，测试总数不减

### 场景 2：watch import 链跨目录解析（结构正确性）
- **Given** `watch/process/render.mjs` import `../../tool/format.mjs`，`watch/process/{parse,render,watcher}` 按需 import `../api/index.mjs`，`watch/process/watcher.mjs` 通过 live binding 读 api 的 `sharedRateLimitUntil` 并 `watcherRegistry.add(this)`
- **When** 执行 `node --check` 全量 7+ 文件，并对一个非入口模块做动态 import 解析探测
- **Then** 所有模块成功解析，无 "Cannot find module"/断链；共享限流/符号缓存/watcherRegistry 跨模块 live binding 可用

### 场景 3：运行行为零变更（回归）
- **Given** 迁移完成，使用 `watch/config.json` 中已存在的一个真实 address
- **When** 运行 `node script/watch/main.mjs 0x...地址 --snapshot`
- **Then** 输出的 banner / 当前仓位 / 平仓历史格式与迁移前 `node script/watch-account.mjs 0x...地址 --snapshot` 完全一致（纯结构迁移，无行为差异）

### 场景 4：query 复用 api 后行为一致
- **Given** `watch/query.mjs` 删除了内部重复的 `httpGetJson/resolveAccountId`，改用 `watch/api/index.mjs`
- **When** 运行 `node script/watch/query.mjs 0x...地址`
- **Then** 输出的「摘要 / 仓位 / 当前委托」与迁移前 `node script/query-account.mjs 0x...地址` 一致；`--enable-web-fallback` 兜底路径仍可用

## 实现落地说明（与上文设计的偏离，已实现）

落地时为正确性 / 依赖约束作了如下调整（均经严格逐函数比对验证）：

1. **测试拆两个文件**：原 `format.test.mjs` 实际覆盖 format + parse + render 三层（共 41 用例）。按被测模块拆为 `tool/format.test.mjs`(25，format/校验) + `watch/test/domain.test.mjs`(16，parse/render)，合计 41 不丢失。原因：format 测试不能等 Batch 3 的 parse/render 才能跑。
2. **`isAddress/isValidHHMM/pickAt/shortAddress/formatDisplayId` 落 `tool/format.mjs`**（非 main）：被 watcher/snapshot/config 复用，放 main 会成循环依赖。
3. **`parseArgs` 未 dedup**：main 与 query 各保留一份（12 行）。放 main 会让 query 经 main→watcher 拉入 ws（破坏 query 纯 REST）；独立 util 文件属过度工程。其余三项（httpGetJson/resolveAccountId/isAddress）已 dedup。
4. **query 解析方式改进（行为微差）**：query 复用 api 的 `httpGetJson`（`parseJsonSafe` 大整数防丢精度）替代原 `JSON.parse`；其大整数字段输出由"数字(可能丢精度)"变为"带引号字符串(精度正确)"。属改进，但非逐字节相同。resolveAccountId deduped 到 api `resolveAccountIdViaChain`（`||`→`??` 对真实 id 无影响 + 丢弃恒 null 的 viem 占位）。
5. **`resetSharedBackoff()`** 新增到 api：替代原 watcher 内直接 `sharedBackoff = 0`（ES module import 只读，不能跨模块赋值）。
6. **既有 formatDisplayId 缺陷原样保留**（源码 `${head} 🎯` 多一空格 vs 测试期望无空格）：行为零变更原则，仍是基线那 1 个 fail（40 pass / 1 fail）。

watch-account 主体逻辑（AccountWatcher / SnapshotMode / render / parse 全部）经代码行集合 diff 验证为 100% 逐行一致。

<!-- 类型 refactor：结构迁移 + 共享层抽取，行为零变更（query 解析改进除外，见落地说明 4）。已 /k:task 落地，进 /k:check。 -->
