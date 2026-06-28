# hype 跟单：dry-run → 实盘 待办清单（go-live checklist）

> 一期落地止于 **dry-run**（不签名、不发真实订单）。本文记录从 dry-run 切到真实下单**还差什么**，每项带代码触点，便于后续逐项 gated 推进。
> 总纲后续阶段见 `.claude/kit/spec/auto-copy-trade/00-overview.md §8`；实现细节见 [`hype.md`](./hype.md)。

---

## 〇、🔝 最优先：抽 PositionStream 共享 → 事件驱动对账

> **优先级高于本文其余所有项**。当前 `main.mjs` 是纯 15s REST 轮询（空转查接口 + 最多 15s 延迟），与"目标不动我们不动"的预期不符。本档把触发模型改成事件驱动。

**核心原则：复用 = 直接拿现有 watcher 处理一下用，不重写一套 WS。**

- `sodex-watch/process/watcher.mjs` 的 `AccountWatcher` 已实现 WS 订阅 + 仓位变化指纹 + 断线重连；`HYPE-watch` 对称有一套。**这两套是现成轮子，直接复用，不重造。**
- 障碍：`AccountWatcher` 当前把"变化检测"和"渲染 + 推 watch TG + 每日快照"焊死，没暴露干净的 `onChange` 回调；且 sodex / hype 是两套不同 WS 协议。

**做法（抽检测内核，薄封装复用）**：

```
抽出共享「变化检测内核」（WS 订阅 + 指纹 + 变化回调），保留各平台协议差异：
  统一接口： onChange(归一化目标仓位[])     ← copy 只认这个，不关心底层哪套 WS
     ├─ sodex 源 → 复用 sodex-watch watcher 的检测内核（sodex WS 协议）
     └─ hype 源  → 复用 HYPE-watch watcher 的检测内核（hype WS 协议）
  copy main：onChange 触发 reconcileOnce()；REST 周期对账降为 ~180s 兜底（防漏接 WS 事件）
```

**关键边界**：
- **按平台各复用各 watcher**，不是合成一个共享类（sodex/hype 协议不同）。DRY 体现在 copy 不重写 WS、直接用对应平台已有那套。
- **映射表正交、且自动化**：`mapSymbol`（sodex→hype）在 copy 侧、拿到原始仓位**之后**才做翻译，不进 stream。"不定期更新映射"用 **hype 实时 universe 校验**解决——`buildHypeAssetIndex` 已每 6h 拉 hype `meta`，让 `mapSymbol` 校验 coin 是否在当前 universe（不在=不可映射），随 hype 上下架自动跟，零手维护（阶段1 留的口子，当时直通未接）。
- **进程隔离不变**：copy 仍跑 `trader-exec`、各自持 WS 订阅，不和 watch（`tracker` 只读）混进程。
- **对账仍必要**：事件只决定"何时动手"，对账决定"怎么动手"——收到事件后**对齐目标完整净仓**（非复制单个动作），才能自愈断线/重启/部分成交/漏单。

**代码触点**：抽 `service/lib/`（或 watch/process）共享检测内核 → 小重构 `sodex-watch` + `HYPE-watch`（动 live 服务，需单独 checkpoint + 回归）；`main.mjs` 接 onChange + REST 降 180s 兜底；`mapping.mjs` 接 hype universe 校验。

---

## 一、一期已完成（dry-run 可跑）

- 配置加载 + 单目标硬限制（`process/mapping.mjs`）、标的映射（sodex 映射表 / hype 直通）。
- 资金模型（`process/sizing.mjs`、`recommend.mjs`）、校验门六分支（`process/risk.mjs`）、收敛对账（`process/reconcile.mjs`）。
- dry-run would-place 构造（`api/index.mjs` `placeDryRun`，**不签名**）、推送 + JSONL + 统计（`notify/index.mjs`、`process/stats.mjs`）。
- systemd 隔离编排（`app/index.mjs`，trader-exec + 资源上限 + 加固，wallet 注入留占位）。
- 46 条纯函数单测全绿。

---

## 二、切实盘必须逐项关闭的缺口（gated）

| # | 缺口 | 当前状态 | 代码触点 | 阶段 |
|---|------|----------|----------|------|
| 1 | **sodex 字段核对** | `symbol`/`leverage`/`marginUsed` 缩写键未经权威文档证实，用候选键回退 + 派生 | `api/index.mjs` `normalizeTargetPositions`（标了 TO-VERIFY） | 实跑前 **必做**：`node service/sodex-watch/query.mjs <addr> --raw` 核对真实字段名后修正 |
| 2 | **真实可用余额** | dry-run 用 `targets.json.availBalanceSim` 模拟 | `main.mjs` `avail`（注释标 dry-run 模拟） | 接 hype `clearinghouseState({user}).withdrawable` 替换模拟值 |
| 3 | **Agent Wallet 授权** | 仅占位 `agentKeyRef`，无真实 key | 设置 5 步见总纲 §3.6 / blueprint §10.7 | 主钱包 `approveAgent` → 生成独立 agent key → `/etc/tracker/HYPE-copy-<id>-agent.key`(chmod 600, trader-exec) |
| 4 | **systemd 注入 key** | 模板里 `LoadCredential` 仅注释 | `app/index.mjs` `hypeCopyTemplateUnit`（取消注释那两行） | 配合 #3，执行器读 `$CREDENTIALS_DIRECTORY/agent-key` |
| 5 | **真实下单签名** | `placeDryRun` 在 `dryRun!==true` 时 `throw` 占位 | `api/index.mjs` `placeDryRun` 的 throw 分支 | 接 EIP-712 phantom agent 签名 + `@nktkas` `ExchangeClient.order`（blueprint §8.2/§8.3） |
| 6 | **dryRun 标志翻转** | `targets.json.dryRun=true` 恒真 | `targets.json` | 测试网验证通过后逐目标置 false |
| 7 | **杠杆同步** | 总纲 §3.2 列了 `wouldUpdateLeverage`，**一期未实现** | 新增 `process/` 逻辑 + `api` `updateLeverage`（blueprint §8.3 长键参数） | 真实下单前补；下单前同步目标杠杆 |
| 8 | **事件触发** | `main.mjs` 仅 `RECONCILE_INTERVAL` 周期轮询；watch 事件触发**未接线** | 见 **§〇 最优先档**（抽 PositionStream 复用 watcher） | **最优先**（已提到 §〇），不是可选 |
| 9 | **真实 fee / 滑点** | dry-run 估算 `fee="0"`/`slippageBps=0`（fillPx 假定=refPx） | `main.mjs` emit place、`notify` toLogLine | 主网读回执实际 `status.filled` / fill fee 回填 |
| 10 | **MAX_CHASE_BPS 放弃逻辑** | 参数语义已写文档，**放弃跟单判定未接线** | `process/risk.mjs` 或 `main.mjs`（参考价偏离超阈值放弃） | 真实下单前补（防追高接盘，blueprint §10.5） |

---

## 三、灰度顺序建议（从安全到激进）

> 注：**§〇 事件驱动重构**与本灰度正交——它是触发机制改造，应在 **dry-run 期**完成（不依赖真实下单），优先级最高，先于下面实盘灰度。

1. **字段核对**（#1）：先 `--raw` 跑通，确认 sodex 仓位 / 保证金 / 杠杆解析正确——否则 ratio 分母错，全盘皆错。
2. **dry-run 联网观察**：保持 `dryRun=true`，部署后看 JSONL / 推送的 would-place 是否合理（名义、方向、ratio）。
3. **Agent Wallet + 测试网**（#3#4#5#7）：测试网真实下单，小额验证签名 / 精度 / 滑点保护。
4. **主网小额**（#6）：单目标、低 `maxDeployPct`、小 `availBalance`，观察 fee 侵蚀（`stats.mjs`）。
5. **逐步放开**：确认稳定后再调高部署比例 / 真实 fee 回填（#9）。

---

## 四、更远的增量（不在切实盘关键路径）

- 独立多目标 + 资金分配层（放开单目标硬限制；`capitalWeight` 两层分配，N 个独立 1:1）。
- N:1 共享账户净额收敛。
- 目标熔断自动判定阈值（累计回撤超阈值停跟平仓）。
- sodex 执行腿（对称加 `docs/copy/sodex.md`）。

---

## 五、部署前检查清单

- [ ] `targets.json` 已按 `targets.example.jsonc` 填好（单目标、真实 `source.address`）。
- [ ] `sodex` 字段已 `--raw` 核对（#1）。
- [ ] `trader-exec` 用户已建、`targets.json` 已 `chmod 600` + `chown trader-exec`（见 `hype.md §六`）。
- [ ] WARP 代理可用（`HTTP_PROXY`），sodex gateway + hype info 可达。
- [ ] `app/config.json` 的 `hypeCopy.enabled` / `targets` 已配置。
- [ ] **真实下单前**：#3#4#5#7#10 全部关闭并经测试网验证。
