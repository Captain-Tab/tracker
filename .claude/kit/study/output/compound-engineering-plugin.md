# Study: compound-engineering-plugin

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/EveryInc/compound-engineering-plugin.git |
| 分析日期 | 2026-05-30 |
| Commit | 85987d49 |

> 本文档结论经过三轮演进：初判 → 反向验证翻转 → 深挖机制层修正。最终落点见文末「修正后的最终裁决」。保留演进过程是为了让结论可核查、可追溯依据强度。

---

## 核心思想与原则

**复利工程（Compound Engineering）**：每一个工程单元都应让后续单元更容易，而非更难（README "Philosophy"）。传统开发不断累积技术债，复利工程反转这一点——**80% 投入规划与复盘，20% 投入执行**。

核心信条：
- 充分规划再写代码（`ce-brainstorm` + `ce-plan`）
- 复盘校准判断力（`ce-code-review` + `ce-doc-review`）
- **把知识编码成可复用资产**（`ce-compound`）——"第一次解决问题要研究，文档化后下次只要几分钟，知识产生复利"（ce-compound/SKILL.md:15）

## 核心流程

主循环：`brainstorm → plan → work → review → compound → 带更好上下文重复`。上游有 `ce-strategy`（产出 `STRATEGY.md` 产品锚点），读侧有 `ce-product-pulse`（时间窗内的用户体验报告）。

规模：**37 skills + 51 agents**，跨 Claude Code / Codex / Cursor / Gemini 等 7 个平台（`src/converters/claude-to-*.ts`）。

四个最具代表性的机制（机制层，非功能层）：

1. **ce-compound 多 subagent 并行沉淀**（ce-compound/SKILL.md:113-188）：Context Analyzer / Solution Extractor / Related Docs Finder 并行返回文本数据，仅 orchestrator 落盘到 `docs/solutions/`，带 YAML frontmatter 可检索；末尾跑 `validate-frontmatter.py` 防止 YAML 静默损坏。**Discoverability Check**（ce-compound/SKILL.md:298）每次都检查并在必要时把"知识库入口"小幅写回 AGENTS.md/CLAUDE.md。

2. **分层 persona reviewer 流水线**（ce-code-review/SKILL.md:128-160）：6 个 always-on reviewer + 按 diff 条件选取的 cross-cutting / stack-specific persona，并行返回结构化 JSON → merge/dedup。

3. **锚定置信度评分 + 抑制阈值**（ce-correctness-reviewer.md:30-40）：每个 reviewer persona 用 100/75/50/25 锚点，**Anchor 25 以下直接 suppress（不报）**。把"只报确信的问题"从原则升级为可执行的机械阈值。

4. **深度分档与对抗审查技术**（ce-adversarial-reviewer.md:14-26）：按 diff 规模/风险信号选 Quick/Standard/Deep 三档深度并配 findings 配额；对抗 reviewer 用 4 类结构化攻击技术（assumption violation / composition failures / cascade construction / abuse cases）。

此外，`AGENTS.md` 是其元规则文件（对标 soso-kit 的 constitution），其中 "Skill Design Principles"（AGENTS.md:97-130）与 "Rationale Discipline"（AGENTS.md:167-172）值得单独对照。

## 优势与劣势

### 优势
- 理念清晰且贯穿全链路——知识复利不是口号，落到 `docs/solutions/` + 回写 instruction file 的具体机制
- reviewer persona 带**锚定置信度 + 抑制阈值**，把"不凑数"可执行化
- skill 双入口（人交互 / 程序化 headless/autofix/report-only）设计成熟，支持 skill-to-skill 编排
- 元规则层成熟：处方强度按失败模式分档、rationale 纪律、token 抽取约定、frontmatter 校验脚本

### 劣势
- 体量巨大（37 skills + 51 agents），学习与维护成本高，面向团队而非单人
- 跨 7 平台转换层是重资产，仅服务多 harness 用户
- 多 persona 并行 review token 成本高

## 与 soso-kit 对比

> 对比基于自画像，仅作方向判断。"是否已有/是否需要"以下方第 0 问源码为准。

| 维度 | compound-engineering | soso-kit | 启发 |
|------|----------------------|----------|------|
| 工作流主线 | brainstorm→plan→work→review→compound | clarify→spec→plan→task→check/commit/pr | 高度同构，独立收敛 |
| 知识沉淀 | ce-compound 并行沉淀 + 回写 instruction | distill + pitfall + context-learn + Context Library | 双方都有，机制不同 |
| 代码 review | 14+ persona 并行 + JSON merge + 置信度抑制 | 单 agent 8 步 + 4 维度 PASS/FAIL | 置信度抑制可对照 |
| 判断机制 | 锚定置信度 100/75/50/25 + 深度分档 | VERDICT 机械评分 simple/medium/complex + 不凑数 | 同源，soso-kit 已有 |
| 元规则判据 | "能否说出规则阻止的具体坏结果" + Trust 档 | "删了会怎样" + 严格≠繁琐分层 | 判据同义，Trust 档可补 |
| token 架构 | conditional/late 块按 20%+ 抽取到 references | 红线瘦身版 + 按需 Read（figma/plan/spec 各 3 处 stub） | 已有等价实践 |
| 平台覆盖 | 7 平台转换 | 仅 Claude Code | 单平台无需转换 |
| 产品层 | STRATEGY.md | 无（纯工程工具） | 超出 soso-kit 定位 |

## 借鉴建议

> 零假设 = 不借鉴。任何 ✓/~ 必须附 soso-kit 源码 `file:line`（证明缺失）或实测输出。

### 0. 零假设校验（先答）

默认结论 = 不借鉴。逐候选附 soso-kit 源码证据：

**功能层候选（首轮 + 翻转后均判 ✗）：**

- **compound 知识沉淀循环**：soso-kit 现状 distill.md（蒸馏使用习惯）+ context-pitfall.md（已知问题库）+ context-learn（从代码逆向生成文档）→ 等价物已存在 → **重复造轮子（✗）**。
- **Discoverability 回写 instruction file**：soso-kit 现状 = always-on 注入 essential 规则 + Context 查询命令族（自画像 L98-99）→ 真问题但已用注入路径解决 → **边际（~），单人场景下注入已够 → ✗**。
- **多 persona 并行 reviewer**：review.md 单 agent 8 步；自画像 L94 记录"反同源 subagent，实测 0 命中已删除" → CE 的 persona 是不同视角非同源，张力部分成立，但 14 agent 对单人前端项目成本超收益 → **过度设计（✗）**。
- **跨平台转换器**：soso-kit 仅 Claude Code → 伪需求 → **过度设计（✗）**。
- **STRATEGY.md 产品锚点**：soso-kit 定位 = 代码工程工具集（自画像 L5），无产品战略职责 → **超出定位（✗）**。

**机制层候选（深挖后重新评估）：**

- **review severity × 路由双维度**：review.md:184-194 **已有** 4 维度分类表（完整性/规范/边界/意图）+ 逐条 file:line FAIL 详情，并非"仅 PASS/FAIL"。且 CE 的 P0-P3 灰度与 review.md:204,215「二元判定 + 不凑数」冲突、autofix_class 与 review.md:211「review 只读」冲突 → **从初判 ~ 降为 ✗（首轮误判，补读后纠正）**。
- **锚定置信度 + 抑制阈值**：distill.md:115 **已有**"置信度声明 低/中/高 + 写明什么证据推翻它"，但 review.md 未用 → 真空白存在 → 然而抑制阈值为多 persona 并行去噪而生，单 agent 本就该"只报确信的"（review.md:215） → **边际补充（~），落地收益小**。
- **token 块抽取架构**：soso-kit **已有等价实践**——红线"v1.11.0 瘦身版 + 完整见 components.md"、figma/plan/spec/ui 各 3 处 stub。CE 仅多了「~20%+ 占比 / 按 tool 调用次数」量化触发判据 → **已有（✗）**。
- **元规则处方判据 + Trust 档**：constitution「严格≠繁琐」+ strict-vs-cumbersome「删了会怎样」**同义** CE 的"能否说出规则阻止的具体坏结果"；但 CE 多一条「Trust 档——过度处方 robs agent of intelligence，无具体坏结果的规则应倾向信任」自觉 → soso-kit `rules/modules/` 偏 Hard rules（auth.md 大量"禁止X"），缺此反查视角 → **边际补充（~）**。

### 1. 对 soso-kit 帮助大吗？

**小。** 绝大多数能力 soso-kit 已有同源等价物（知识沉淀、判断机制、token 架构、元规则判据）或不适用（多平台、产品层）。深挖机制层后确认：**没有触及 soso-kit 核心机制的借鉴点**，仅余两个边际补充：①review finding 可选标注置信度（distill 已有该模式，属内部复用）；②用 Trust 档判据反查 `rules/modules/` 是否过度处方。

### 2. 有必要吗？

**不必要。** 两个边际点收益均 < 维护成本：
- 置信度抑制：单 agent review 无多源噪音可去，且引入"低/中"档反而有诱导凑数风险（违反 review.md:215）。
- Trust 档反查：是一次性心智校准，不需要写成常驻规则。

### 3. 更新后能提升哪些？

- ⚠️ 不提升：知识沉淀、判断机制、token 架构、跨平台、产品战略——均已有等价物或不适用。
- 若坚持落地，唯一可触及 `rules/modules/` 的过度处方反查（属人工 review 动作，非命令改动），不增加常驻 token。

### 4. 结论

**不做（命令/规则零改动）。** 仅把"Trust 档判据"作为一次性心智记入团队认知，下次写 `rules/modules/` 规则时自检"这条规则阻止的具体坏结果是什么，说不出就删"。其余全部跳过。

- 分级：**边际补充**（无核心借鉴点）
- 成本：落地为 0（不改命令、不增常驻规则）
- 收益：交叉验证 soso-kit 内核正确性 > 任何可抄机制

**一句话**：成熟度极高的团队级同类标杆，与 soso-kit 在工作流主线、判断机制、元规则判据上**独立收敛到同源设计**，反向印证了 soso-kit 内核是对的；可抄的只剩边际补充，对单人/单 agent/单平台的 soso-kit 落地收益低于维护成本，故命令与规则零改动。

---

## 修正后的最终裁决

```
有值得借鉴的点吗？
  → 有边际补充点，无核心借鉴点。
  → 且每个候选 soso-kit 都有同源等价物：
      distill 置信度声明 / 红线瘦身 stub / constitution 处方判据。
  → CE 版本只是更机械化（带量化触发 / 抑制阈值），
    对单人+单 agent review+单平台的 soso-kit，落地收益 < 维护成本。

真正收获不在抄机制，在两点交叉验证：
  1. soso-kit 判断机制（VERDICT 评分/不凑数/信号密度/按层分严格度）
     与团队级标杆独立收敛 → 内核被反向印证。
  2. CE 唯一比 constitution 多的「Trust 档」自觉（AGENTS.md:104-107）：
     无具体坏结果的规则应倾向信任 AI，可作 rules/modules 过度处方的反查视角。
```

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~2339 tokens |
| 分析阶段（含两轮深挖验证） | ~16000 tokens |
| 文档阶段 | ~4500 tokens |
| **总计** | **~22800 tokens** |

## 变更记录

- 2026-05-30: 首次分析（结论经初判→翻转→深挖三轮演进，最终落点「有边际补充点、无核心借鉴点」）
