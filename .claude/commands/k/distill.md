---
description: 读取最新 insight 报告，套用查重+门槛+完整性纪律，蒸馏出"扩展/新建/skip"决策，输出带日期、可核查无遗漏的报告到 docs/distill
---

# Distill: 把使用习惯蒸馏成可复用资产

> 消费 `/insights` 的本地聚合报告，补上它最大的盲区——**对 skill 库失明导致的重复建议**。
> 引擎是用户提供的 Codex 自我工具化提示词。本命令**纯 prompt、零脚本、零维护**。
> 设计目标：产出一份**令人信服、可核查无遗漏**的报告——报告里每一条 insight 信号都必须有明确去向，不允许静默丢弃；并基于**两份报告的真实数字**给出"最近提升 vs 倒退"硬证据对比。

## 用户输入（可选）

```text
$ARGUMENTS
```

- 留空 → 自动读取 `docs/insight/` 下日期最新的报告
- 传入路径 → 分析指定报告
- 传入 `--dry` → 只在对话输出 shortlist，不写报告文件

---

## Phase 0: 定位报告

**使用 Bash 工具**：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
INSIGHT_DIR="$KIT_ROOT/docs/insight"
DISTILL_DIR="$KIT_ROOT/docs/distill"; mkdir -p "$DISTILL_DIR"
LATEST=$(ls "$INSIGHT_DIR"/report-*.html 2>/dev/null | sort | tail -1)
PREV=$(ls "$INSIGHT_DIR"/report-*.html 2>/dev/null | sort | tail -2 | head -1)
echo "LATEST=$LATEST"; echo "PREV=$PREV"; echo "GEN_DATE=$(date +%F)"
```

- `LATEST` 为空 → 输出 `❌ docs/insight/ 下没有 insight 报告，请先运行 /insights` 后**终止**。
- 从 `LATEST` 文件名提取 `REPORT_DATE`。用户若传路径则覆盖 `LATEST`。

---

## Phase 1: 穷举抽取（完整性的锚）

**使用 Bash 工具**去样式抽正文：

```bash
strip() { perl -0777 -pe 's/<style.*?<\/style>//gs; s/<script.*?<\/script>//gs' "$1" | sed -e 's/<[^>]*>/ /g' | tr -s ' \t' ' ' | grep -v '^ *$' | sed 's/^ *//'; }
echo "===== LATEST ====="; strip "$LATEST"
[ -n "$PREV" ] && { echo "===== PREV ====="; strip "$PREV"; }
```

**穷举建清单（这是无遗漏的保证）**——把报告里所有可执行信号逐条编号登记，分四类，一条都不许漏：

- **F. 摩擦点**：来自「哪些地方出了问题」「主要摩擦类型」「遇到的工具错误」——每条带次数。
- **W. 重复工作流**：来自「你在做什么」「你想要做什么」——每条带会话数。
- **S. 报告自带建议**：来自「值得尝试的功能」「新的使用模式」「未来展望」——逐条登记（这些是**待审视对象**，非待采纳项）。
- **R. 跨报告复现**：若 PREV 存在，标注每条 F/W 是否两份都出现。

> 登记后给出 `信号总数 = |F|+|W|+|S|`。Phase 4/5 必须让这 N 条全部有去向——这是后面"完整性自审"核对的基准。

---

## Phase 1.5: 跨报告趋势对比（基于真实数据找真实依据）

> 目的：识别**最近哪些在提升、哪些在倒退**，每条结论必须能指向两份报告里的具体数字。
> 这一步不允许"感觉变好/变差"——只接受 `上期值 → 本期值` 的硬对比。
> 没有 PREV 时跳过本 Phase，并在 Phase 6 报告里写「首份报告，无跨期对比」。

**使用 Bash 工具**从两份报告抽数字（已在 Phase 1 strip 输出里，但这里聚焦到指标）：

```bash
# 已知两份报告的 strip 输出在内存里——直接对照下列字段
# 必须抽取的硬指标（每项都要在两份报告里找数）：
# 1. 头部统计：会话数 / 消息数 / 代码行 / commits / 时间跨度
# 2. 主要摩擦类型 top 6：wrong_approach / misunderstood / excessive_changes / buggy_code / user_rejected / output_token_limit
# 3. 工具错误 top 6：command_failed / edit_failed / file_changed / file_not_found / user_rejected / file_too_large
# 4. 达成结果：fully / mostly / partially / unclear（绝对值 + 占比）
# 5. Top 工具：Bash / Edit / Read / TaskUpdate / TaskCreate / Skill
# 6. Multi-Clauding：重叠事件 / 涉及会话 / 消息占比
# 7. Fun ending：是否与上期同例（同一个梗连续出现 = 评估系统也在重复）
```

**输出格式**（在对话中产出，并写进 Phase 6 报告"五、跨报告趋势"章节）：

| 维度 | 上期(PREV_DATE) | 本期(REPORT_DATE) | 变化 | 判定 |
|---|---|---|---|---|
| commits | <n> | <n> | <Δ/%> | ✅/⚠️/— |
| wrong_approach | <n> | <n> | <Δ> | ✅/⚠️/— |
| buggy_code | <n> | <n> | <Δ> | ✅/⚠️/— |
| output_token_limit | <n> | <n> | <Δ> | ✅/⚠️/— |
| 完全达成占比 | <%> | <%> | <Δ> | ✅/⚠️/— |
| ...（穷举所有可比指标）|

**强制规则**：
- 每行必须有具体数字，禁止「略升 / 大幅下降 / 显著改善」这种无数字描述
- 数字缺失（某指标只一期有）→ 单独列「**新增信号**」或「**消失信号**」清单
- 上期 distill（若 `docs/distill/distill-<PREV_DATE>.md` 存在）必须读取，核查上次「建议创建/扩展」和「待证据」项**本期是否兑现**（即上次扩展某命令→本期该类摩擦次数是否下降）

**得出三段结论**（每条必须挂硬数据）：

- **✅ 提升**（≥3 条，每条附 `上期→本期` 数字 + 可能归因）
- **⚠️ 倒退/未解决**（≥3 条，每条附 `上期→本期` 数字 + 是否上期已点名）
- **🔁 评估系统的重复信号**（同一个 fun-ending / 同一句"建议"连续出现 → 提示评估器在打转，需人为去重）

> 这三段结论是 Phase 6 报告的「五、跨报告趋势」章节的内容。它**独立于** Phase 4 Shortlist——shortlist 是"该做什么"，趋势是"做的事生没生效"。

---

## Phase 2: 查重（强制，本命令的核心价值）

> insight 对你的资产库失明，会建议你新建已存在的东西。逐条把信号对照现有资产。

**使用 Bash 工具**：

```bash
echo "=== /k 命令 ==="; ls "$KIT_ROOT/.claude/commands/k/" | sed 's/\.md$//' | paste -sd' ' -
echo "=== skills ==="; ls "$KIT_ROOT/.claude/skills/" | grep -v DS_Store | paste -sd' ' -
echo "=== hooks ==="; grep -c '"hooks"' "$KIT_ROOT/.claude/settings.json" 2>/dev/null || echo "无 hooks"
echo "=== constitution 已有约束 ==="; grep -nE "改动前先讨论|先分析|只读|根因|过度|最短" "$KIT_ROOT/.claude/rules/essential/constitution.md"
ls "$KIT_ROOT/.claude/rules/essential/"
```

可选 `/k:context list` 确认 context library 覆盖。为每条信号打**覆盖标记**：
- `已是规则缺执行` ｜ `命令已存在` ｜ `可扩展` ｜ `真空缺`

---

## Phase 3: 套用 Codex 纪律

对**每一条登记信号**逐条裁决（不许跳过任何一条）：

**证据优先级**：① insight 量化统计（次数/会话）② 跨报告复现 ③ git log / MEMORY.md / context ④ 报告自带建议（仅线索，必须经 Phase 2 查重，不直接采纳）。

**准入门槛**（四条全过才进 create/extend）：
- 复现 ≥ 2 次，或明显会复发且重复成本高
- 有稳定输入、可复现流程、明确产出/停止条件
- 能实质提升 速度/质量/一致性/可靠性
- 尚未被现有资产充分覆盖（看 Phase 2 标记）

**形态**（取最小）：扩展已有 ＞ 规则强化(已是规则缺执行) ＞ 新建 skill/命令(真空缺) ＞ Hook/自动化 ＞ Skip。

---

## Phase 4: Shortlist（覆盖全部信号）

对话中先输出。**表格行数必须 = 信号总数 N**，每条登记信号都在表里占一行：

| # | 信号(F/W/S 编号) | 证据(次数/会话/复现) | 置信 | 覆盖标记 | 推荐形态 | 裁决理由 |
|---|---|---|---|---|---|---|

---

## Phase 5: 完整性自审（让报告令人信服的关键）

> 这一步专门回答"有没有遗漏"，并暴露本次分析的边界。

1. **去向核对**：逐一确认 Phase 1 的 N 条信号都在 Phase 4 表里有一行、有明确去向（create/extend/evidence/skip）。列出 `已覆盖 N/N`，若有遗漏立即补。
2. **裁决分布**：统计 create_x / extend_y / evidence_z / skip_w，确认总和 = N。
3. **扫描边界（诚实声明）**：
   - 扫了什么：本报告 + （若有）上一份报告 + 现有 /k 命令/skill/hook/constitution。
   - **没扫什么**：未读 transcript（设计如此——insight 已是其聚合）；未跨 sodex-* 业务仓代码核验。这些是已知盲区，需要时人工补。
4. **置信度声明**：每个 create/extend 项标 低/中/高，并写"什么新证据会推翻它"。

---

## Phase 6: 写报告（除非 `--dry`）

**使用 Write 工具**写 `docs/distill/distill-<REPORT_DATE>.md`：

```markdown
# Distill 报告 — 基于 insight <REPORT_DATE>

> 生成于 <GEN_DATE> ｜ 源报告 report-<REPORT_DATE>-zh.html（<会话/消息数>）
> 对照 report-<PREV_DATE>（跨报告复现判断）｜ 引擎：Codex 提示词 + soso-kit 资产查重

## 摘要（一屏看懂）
- 信号总数 N ｜ 裁决：新建 x / 扩展 y / 待证据 z / 跳过 w
- 一句话结论：<例如 "5 条建议过滤后 0 真空缺，价值集中在扩展 3 个现有命令">

## 一、Shortlist（覆盖全部 N 条信号）
<Phase 4 表>

## 二、决策三段收口
### ✅ 建议创建 / 扩展
- <形态 + 落点(具体命令/文件) + 置信度 + 一句理由>
### ⏸ 需更多证据
- <缺什么证据才能打包>
### ⏭ 故意跳过
- <因哪条门槛被刷掉>

## 三、完整性自审
- 去向核对：已覆盖 N/N（若曾遗漏，写补了哪条）
- 裁决分布：create x / extend y / evidence z / skip w = N
- 扫描边界：扫了 X；**未扫** transcript / 业务仓代码（已知盲区）

## 四、与 insights 原始建议的差异
- insights 建议了什么 → 查重/门槛后改判了什么（点名重复/命名冲突项）

## 五、跨报告趋势（基于真实数据）
> 没有 PREV 时写「首份报告，无跨期对比」并跳过本节。

### 硬指标对比
<Phase 1.5 表格>

### ✅ 提升（每条挂 `上期→本期` 数字）
- <数字证据 + 可能归因（含「上期 distill 决策是否生效」）>

### ⚠️ 倒退/未解决（每条挂 `上期→本期` 数字）
- <数字证据 + 是否上期已点名但未动手>

### 🔁 评估系统的重复信号
- <同一 fun-ending / 同一建议连续出现 → 提示评估器在打转>
```

写完把「摘要 + 完整性自审 + 五、跨报告趋势的提升/倒退」回贴到对话。

---

## Phase 7: 收尾

**只产报告，不自动建资产。** 询问用户「建议创建/扩展」里要先动哪一项，还是停在报告层。等用户选择再实施。

---

流程结束。
