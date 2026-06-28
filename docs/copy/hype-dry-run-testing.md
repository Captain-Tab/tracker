# hype 跟单 · dry-run 测试与字段核对记录

> 测试期专用：① sodex 字段真实核对（go-live #1，**实跑前必做**）；② 运行日志怎么看；③ 问题 / 观察复盘记录（持续追加）。
> 关联：[`hype.md`](./hype.md)（系统说明）、[`hype-go-live.md`](./hype-go-live.md)（dry-run→实盘缺口）。

---

## 一、运行日志在哪 / 怎么看

跟单执行器已内置**每动作一条 JSONL** + **journald** 两条日志（`notify/index.mjs`）：

| 日志 | 位置 | 看什么 |
|------|------|--------|
| 逐动作 JSONL | `service/HYPE-copy/log/HYPE-copy-<target>-<date>.jsonl`（gitignore，本地） | 每个 place/skip/noop/min-capital/error 一行，含 coin/side/size/refPx/result/reason |
| journald | `journalctl -u HYPE-copy@<id> -f`（VPS） | 实时流，level 分级（place=info / skip=warn / error=err） |
| 本地直跑 stdout | `node service/HYPE-copy/main.mjs --target=<id>` | 同 journald 内容打到终端 |

复盘查询示例（VPS / 本地通用）：

```bash
# 当天所有 place 动作
cat service/HYPE-copy/log/HYPE-copy-demo-1-$(date +%F).jsonl | grep '"result":"place"'
# 所有 skip / 告警
cat service/HYPE-copy/log/*.jsonl | grep -E '"action":"(skip|cap-warn|error)"'
# 周期统计（笔数 / Σfee / 滑点）——用 process/stats.mjs 的 aggregateStats 喂 JSONL 行
```

> JSONL 已是结构化审计源，**dry-run 测试无需额外运行日志**；本文 §三/§四 是给**人工观察 / 字段核对结论**用的，与机器 JSONL 互补。

---

## 二、sodex 字段核对流程（实跑前必做）

`api/index.mjs` 的 `normalizeTargetPositions` 对 sodex REST `state.P[]` 的 `symbol`/`leverage`/`marginUsed` 用了**候选键回退 + 派生**（权威文档未列这些缩写），**必须用真实数据核对**，否则 ratio 分母错、全盘换算错。

### 步骤

```bash
# 1) 抓目标地址的真实 state 原始响应（含 P[] 全字段）
node service/sodex-watch/query.mjs <目标地址> --raw > /tmp/sodex-raw-<addr>.json 2>&1

# 2) 看 P[] 数组里每个仓位的真实字段名（重点找：币种符号 / 杠杆 / 已用保证金）
cat /tmp/sodex-raw-<addr>.json
```

### 当前实现的候选键（待核对/修正点）

| TargetPosition 字段 | 当前候选键（`normalizeTargetPositions`） | 已证实? | 真实键名（填） |
|---------------------|------------------------------------------|---------|----------------|
| `symbol` | `s` / `symbol` / `sym` | ❌ 待核对 | |
| `szi`（带符号张数） | `sz` / `szi` / `size` | ✅ `sz`（api-confidence/sodex.md L89） | `sz` |
| `entryPx` | `ep` / `entryPx` / `avgEntryPrice` | ✅ `ep`（同上） | `ep` |
| `leverage` | `l` / `leverage` / `lev` | ❌ 待核对 | |
| `marginUsed` | `mu` / `marginUsed` / `im` → 缺失则派生 `\|sz\|×ep/leverage` | ❌ 待核对 | |

> 核对后若真实键名不在候选里：改 `service/HYPE-copy/api/index.mjs` `normalizeTargetPositions` 的 `pickField([...])` 候选数组，并删掉本表的"待核对"标记。
> 保证金若 sodex 无直给字段，确认 `leverage` 键正确后走派生即可（派生公式已用 precision，无精度问题）。

---

## 三、字段核对结论（核对后填写）

- 核对日期：____
- 目标地址：____
- 结论：symbol=`____`  leverage=`____`  marginUsed=`____`（直给 / 派生）
- 是否已改 `normalizeTargetPositions`：是 / 否
- 备注：

---

## 四、dry-run 观察 / 问题记录（持续追加，复盘用）

> 每次 dry-run 跑完，把"would-place 是否合理 / ratio 是否对 / 有无异常 skip"记一条，便于反馈迭代。

| 日期 | 目标 | 现象 / 问题 | 根因 | 处理 |
|------|------|------------|------|------|
| | | | | |
