# Study: gstack

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/garrytan/gstack.git |
| 分析日期 | 2026-05-30 |
| Commit | 62024d11 |

> 内部借鉴决策记录。「与 soso-kit 对比 / 借鉴建议」节天然引用 soso-kit 命令名（对比目的本身），其余描述保持中性。

---

## 核心思想与原则

一个人的虚拟工程团队：23 个 specialist 角色（CEO / Eng Manager / Designer / Staff Engineer / QA / CSO / Release）+ 8 个工具，全部 slash command + Markdown，MIT 开源（`README.md:17-37`）。最硬的资产不是 prompt，而是一个 Bun 编译二进制驱动的持久化 Chromium daemon——首次 ~3s、之后每命令 ~100-200ms，cookie/tab/localStorage 全程保活（`ARCHITECTURE.md:7-36`）。

三条注入式哲学（`ETHOS.md`）：Boil the Lake（完整实现边际成本趋零）、Search Before Building（三层知识 + Eureka）、User Sovereignty（AI 推荐、用户决策）。

## 核心流程

`office-hours → spec → plan(ceo/design/eng) → 实现 → review/codex → qa → ship → land-and-deploy → canary → retro`（`docs/skills.md:118`）。配套机制：SKILL.md.tmpl + gen-skill-docs 占位符注入（代码即文档真源）、3-tier eval（静态/真实 claude -p/LLM-judge）、多层 prompt injection 防御（本地 BERT + canary token + ensemble 投票）。

## 优势与劣势

**优势**：覆盖产品全生命周期；对自身命令有完整 eval + 防漂移门禁；浏览器 daemon 让 QA/review 能真看真点；/codex 引入异源模型补盲区。

**劣势**：体量极重（单 `review/SKILL.md` 95KB、`CLAUDE.md` 51KB）；角色 prompt 偏价值观陈述；强绑定 macOS+Bun+外部服务（Keychain/ngrok/Greptile/Codex）；靠 persona 软约束，缺机械硬门禁。

## 与 soso-kit 对比

> 对比基于自画像，仅作方向判断。「soso-kit 是否已有 / 是否需要」一律落到源码（见借鉴建议第 0 问）。

| 维度 | gstack | soso-kit | 启发 |
|------|--------|----------|------|
| 核心模型 | specialist 角色矩阵 | clarify→spec→plan→task→check 流水线 | 哲学迥异，难整体移植 |
| 判断机制 | 角色 prompt + 0-10 评分 + 人类终审 | VERDICT 机械评分 + HARD-GATE 原子块 | soso-kit 更抗「AI 自判」 |
| 文档防漂移 | tmpl + gen-docs + CI git diff | profile 已自动生成（`generate-profile.sh:15-31`），脚本引用实测 0 漂移 | gstack 解决的问题 soso-kit 不存在 |
| 自测试 | 3-tier eval | 无（本地工具链，非 CI 产品） | 产品形态差异，非 gap |
| 多模型 | /codex 异源复核 | 删过同源 subagent（共享偏差，实测 0 命中） | 异源是同源死结的解药 |
| Review | 7 专家并行 + pre-emit gate + fix-first | `/k:review` 4 维度单 agent、只读、要 file:line 但不验真伪 | **pre-emit gate 击中真 gap，详见下节** |
| 受众 | 全球开源（MIT） | 中文团队 + sodex 系项目 | 定位不同 |

## 专项：gstack `/review` vs soso-kit `/k:review`（本轮重点）

逐能力点回 soso-kit 源码反证（零假设 = 不借鉴）：

| gstack review 能力 | gstack 出处 | soso-kit 现状（源码） | 裁决 |
|--------------------|-------------|----------------------|------|
| **Pre-emit verification gate**：发结论前引用触发该结论的代码行**原文**（file:line + verbatim），引不出即降置信度并从主报告抑制 | `review/SKILL.md:1182-1218` | `/k:review` Step5/6/7 全程要 `file:line`，但**无**「引用触发行原文 + 引不出即抑制」的闸——信任 AI 给的 file:line 本身（`commands/k/review.md:133,170-172`） | **✓ 核心提升** |
| Enum 跨文件传播：新增枚举值后 grep 全库每个 switch/allowlist 是否处理 | `review/SKILL.md:1151` | Step6 边界只查**函数内**组合穷举，不查跨文件传播（`commands/k/review.md:150`） | ~ 边际 |
| Suppressions / Prior Learnings：白名单抑制已知 FP | `review/checklist.md:170`、`SKILL.md:1106` | review 未接 FP 抑制库；但 soso-kit 已有 pitfall 基础设施（`/k:context-pitfall`），只是没接入 | ~ 边际（基础设施已有） |
| Confidence Calibration：每条结论标 1-10 置信度 | `review/SKILL.md:1162-1180` | 二元 PASS/FAIL（`commands/k/review.md:191`），与确定性取向有张力——但它是 pre-emit gate 的载体 | ~ 随 ✓ 项绑定引入 |
| Specialist 7 专家并行分派 | `review/SKILL.md:1226` | 同源不同视角 prompt = soso-kit 已删的同源 subagent（共享偏差，自画像实测 0 命中） | ✗ 重蹈已验证失败的范式 |
| Fix-First：自动修明显项 | `review/checklist.md:144` | `/k:review` 主动设计为只读（`commands/k/review.md:211`） | ✗ 哲学差异 |
| Scope Drift / Plan Cross-Reference | `review/SKILL.md:797,910` | Step2 意图基准（强制先于 diff）+ Step4 完整性 + Step7 意图审计已覆盖，且更结构化（`commands/k/review.md:51-85,162-172`） | ✗ 已有更强等价物 |

### 追加：diff-size 审查编排（第二轮深挖）

gstack review 最精的是按 diff 规模切换审查强度的编排。证据落地后实际是三层（注意：网传「按 diff 大小切换 adversarial」与源码不符——adversarial 恒开，按 diff 切的是专家与 structured review）：

| 层 | gstack 出处 | soso-kit 现状 | 裁决 |
|----|-------------|--------------|------|
| ① 按规模分级投入（行数 gate 专家 `<50` 跳过；structured review `>200` 或 CRITICAL 触发） | `review/SKILL.md:1269,1408` | **已有更优**：VERDICT 机械评分（simple/medium/complex，下游按档调强度）+ `check --fast`。gstack 用行数阈值，作者自承「LOC 不是风险代理」(`:1586`)；soso-kit 用机械评分更准、抗 AI 自判 | ✗ |
| ② adaptive gating（专家 0 命中 10+ 次自动关） | `review/SKILL.md:1283` | 无，但依赖 soso-kit 没有的持久化命中率（review 不落盘）+ 仅 4 固定维度，收益<成本 | ✗ 过度设计 |
| ③a adversarial 同源（Claude subagent 恒开） | `review/SKILL.md:1586,1608` | 撞 soso-kit 已删的同源 subagent（共享偏差，实测 0 命中） | ✗ 重蹈失败 |
| ③b adversarial 异源（Codex，恒开 when available） | `review/SKILL.md:1621` | 真空白。证伪导向 + 独立偏差源，恰好绕开 soso-kit 删同源的两个失败因（同模型 + 确认式） | ~ 唯一真增量 |

**编排分析落点**：整套 diff-size 编排的三大支柱，两根 soso-kit 已有更优（机械 VERDICT）或主动否决（同源 subagent），一根是过度设计（adaptive gating），**净增量收敛到「异源复核」一处**——与前几轮结论一致，非新增。「分级触发异源」是好的二阶启发，但仅在 soso-kit 真引入异源后才有意义，现在为时过早。

## 借鉴建议

> 零假设 = 不借鉴。任何 ✓/~ 必须附 soso-kit 源码 `file:line` 或实测输出。

### 0. 零假设校验（先答）
- 文档防漂移门禁：soso-kit 现状 `generate-profile.sh:15-31`（清单已自动生成）+ 命令脚本引用实测 0 漂移 → **伪需求** → 过度设计 → ✗（已撤回）
- 自测试 eval 套件：soso-kit 无 CI、无测试目录，是本地工具链 → tier2 真实 E2E 每次 ~$3.85，**成本超收益** → 过度设计 → ✗（已撤回）
- **异源交叉复核（/codex 式）**：soso-kit 自画像记录主动删除同源 subagent → 异源不同模型是**真空白**；review 编排深挖后，整套 diff-size 体系净增量收敛到此一处 → **唯一真增量**（依赖第二模型 CLI，收益未实测） → ~
- Pre-emit verification gate：`/k:review` `commands/k/review.md:133` 要 file:line 但无验真闸 → 真缺失、有核心提升潜力，但 review **不落盘**（`review.md:211`），**无误报样本可证** → 按零假设**暂缓待取证** → ~
- Enum 跨文件传播：`commands/k/review.md:150` 只查函数内 → 真缺失但专项 → 边际 → ~

### 1. 对 soso-kit 帮助大吗？
**小到中**。整体哲学（角色矩阵 + 浏览器底座）与 soso-kit 正交，绝大多数覆盖不上或被 soso-kit 主动否决。深挖 review（含 diff-size 编排）后，真增量收敛到**异源复核一处**——补 soso-kit 主动删同源 subagent 后留下的复核空白。另发现一处系统性缺口：`/k:review` 全程要 `file:line`（`commands/k/review.md:133,170-172`）却不验其真伪，与 `/k:study` 第一轮翻车同根（**要证据、不验证据**）；但因 review 不落盘、无样本，暂列待取证而非该做。

### 2. 有必要吗？
- 异源复核：**非必要但推荐**。是整套 review 体系对 soso-kit 的唯一真增量，补 soso-kit 主动删同源 subagent 后留下的复核空白；前提是本地有第二模型 CLI。
- Pre-emit gate：**暂缓**。痛点（review 假阳性损害 VERDICT 信任）合理，但 review 不落盘、当前无样本证实，按零假设先不做、待样本。
- enum 传播 / pitfall 接入：**非必要但可选**，边际收益。

### 3. 更新后能提升哪些？
- ⏸ 待取证：`/k:review` pre-emit 验真闸（FAIL 必附触发行 verbatim，引不出降级、不计入 VERDICT，对齐 `SKILL.md:1192-1196`）——攒到误报样本再做
- 🔬 待评估：引入异源复核开关，补 soso-kit 复核空白（需第二模型 CLI，收益未实测）
- ⚠️ 不提升：意图基准/完整性/边界三维度——`commands/k/review.md:51-172` 已成体系且强于 gstack，不动
- ⚠️ 不提升：专家分派、fix-first、置信度全量分级、adaptive gating、行数分级——与 soso-kit 既有设计冲突，或 VERDICT 机械评分已更优

### 4. 结论
**本轮暂不动手**。两个候选都未达「该做」门槛：
1. 异源复核（唯一真增量）：值得，但依赖第二模型 CLI + 收益未实测 → 列为待评估，非本轮落地
2. pre-emit 验真闸：痛点合理但无样本证实（review 不落盘）→ 暂缓待取证

- 分级：唯一真增量 = 异源复核（~）/ 暂缓 = pre-emit（~）/ 过度设计 = 防漂移·eval·adaptive gating·行数分级（✗）
- 成本：异源复核触发时一次外部模型调用；pre-emit 每次 review 多若干符号 grep
- 收益：异源复核补独立偏差源、pre-emit 杀符号臆断假阳性——两者均待验证

**一句话**：gstack review 整套体系（含 diff-size 编排）对 soso-kit 的净增量收敛到**异源复核**一处，且仍是 ~（依赖第二模型 CLI、收益未实测）；pre-emit 验真闸痛点合理但 review 不落盘、无样本可证，按零假设暂缓。本轮无达到「该做」门槛的借鉴点，保持观察。

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~3.6k tokens |
| 分析+验证阶段 | ~38k tokens（架构/ETHOS/skills + review SKILL/checklist + 回 soso-kit review.md 反证） |
| 文档阶段 | ~4k tokens |
| **总计** | **~46k tokens** |

## 变更记录

- 2026-05-30: 首次分析（整体对比 + `/review` 命令专项深挖）
- 2026-05-30: 追加 diff-size 审查编排分析；证实 review 不落盘致 pre-emit 无样本可证 → 暂缓；结论收敛到异源复核为唯一真增量（仍 ~，本轮不动手）
