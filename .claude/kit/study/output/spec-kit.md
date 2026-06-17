# Study: spec-kit

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/github/spec-kit.git |
| 分析日期 | 2026-05-31 |
| Commit | 3617cd9 |

---

## 核心思想与原则

**Spec-Driven Development (SDD)**：把"规范"从写完即弃的脚手架升级为**可执行的源**——spec 直接驱动生成实现，而非仅指导实现（`docs/concepts/sdd.md`、README "specifications become executable"）。

工作链由"宪法 + 四个内核命令 + 三个质量命令"组成：`constitution`（项目原则）→ `specify`（写 what/why，禁 how）→ `clarify`（消歧）→ `plan`（技术方案）→ `tasks`（拆任务）→ `analyze`（一致性裁决）→ `implement`（执行），外加 `checklist`（需求质量门）、`taskstoissues`（任务转 issue）。

指导原则：

- **spec 只谈 WHAT / WHY**，成功指标必须可量化且技术无关（`specify.md` "Bad examples: API response time under 200ms"）。
- **澄清节流**：最多 3 个 `[NEEDS CLARIFICATION]` 标记，其余用合理默认值并记入 Assumptions（`specify.md` "LIMIT: Maximum 3"）。
- **用户故事按 P1/P2/P3 优先级 + 独立可测**，每个故事是可独立交付的 MVP 切片（`spec-template.md`）。
- **宪法不可协商**：`analyze` 阶段宪法冲突一律 CRITICAL（`analyze.md` "Constitution Authority"）。
- **Convention over Configuration + Fail-Safe**：扩展缺失静默降级，不破坏内核（`extensions/RFC-EXTENSION-SYSTEM.md` Design Principles）。

---

## 核心流程

`specify init` 把模板/命令安装进目标项目（支持十余种编码代理）；命令间通过 frontmatter 的 `handoffs` 声明交接。SDD 主链全景：

```
 constitution ─▶ specify ─▶ clarify ─▶ plan ─▶ tasks ─▶ analyze ─▶ implement ─▶ (taskstoissues)
   宪法/SSOT     what/why    ≤5单问   分阶段   故事切片   只读裁决    阶段执行       可选·转issue
                                       ║                  ║           ║
                                  Constitution        CRITICAL     checklist
                                   Check ×2            回退plan       gate
```

各命令的职责与产物速查：

| 命令 | 职责 | 产物 · 关键约束 |
|------|------|----------------|
| constitution | 立项目原则（SSOT） | `constitution.md` · 语义化版本 + Sync 报告 |
| specify | 写 what / why | `spec.md` + checklist · ≤3 NEEDS CLARIFICATION |
| clarify | 结构化消歧（可选） | 回写 `spec.md` · ≤5 单问、增量原子写 |
| plan | 技术方案分阶段 | research/data-model/contracts · 宪法 Check ×2 |
| tasks | 按用户故事拆任务 | `tasks.md` · 严格格式 [P]/[US] |
| analyze | 跨产物一致性裁决 | 只读报告 · 宪法冲突=CRITICAL、不改文件 |
| implement | 阶段执行 | 代码 + 回写 `[X]` · checklist gate、失败 halt |
| checklist | 需求质量校验 | `checklists/*.md` · 需求的单元测试 |
| taskstoissues | 任务转 issue（可选） | GitHub issues · remote 须为 GitHub |

展开看每命令的内部子流程 / 产物 / 关卡：

```
用户：specify "需求描述"
    ↓
╔═══════════════════════════════════════════════════════════╗
║  specify — 写规格（what / why，禁 how）                    ║
╚═══════════════════════════════════════════════════════════╝
    ├─ 歧义最多标 3 个 [NEEDS CLARIFICATION]，其余用合理默认
    ├─ 产物：spec.md（用户故事 P1/P2/P3 + 成功指标）
    └─ 产物：requirements 质量 checklist
        ↓ clarify（可选，≤5 单问）→ 增量原子回写 spec.md
        ↓
╔═══════════════════════════════════════════════════════════╗
║  plan — 技术方案（分阶段产物）                             ║
╚═══════════════════════════════════════════════════════════╝
    ├─ Constitution Check（Phase 0 前）          ◀ gate
    ├─ Phase 0: research.md（解决所有 NEEDS CLARIFICATION）
    ├─ Phase 1: data-model.md / contracts/ / quickstart.md
    └─ Constitution Check（Phase 1 后）          ◀ gate
        ↓
╔═══════════════════════════════════════════════════════════╗
║  tasks — 按用户故事垂直切片                                ║
╚═══════════════════════════════════════════════════════════╝
    └─ Setup → Foundational → US1 → US2 → US3 → Polish
       （严格格式：- [ ] T001 [P?] [US?] 描述 + 文件路径）
        ↓
╔═══════════════════════════════════════════════════════════╗
║  analyze — 只读一致性裁决（绝不改文件）                    ║
╚═══════════════════════════════════════════════════════════╝
    ├─ FR-###/SC-### 需求清单 → 映射 task IDs（覆盖矩阵）
    ├─ 6 类检测（重复/歧义/欠规范/宪法/覆盖/不一致）+ 严重度分级
    └─ CRITICAL（宪法冲突 / 零覆盖）─────────────→ 回退 plan / tasks
        ↓ 通过
╔═══════════════════════════════════════════════════════════╗
║  implement — 阶段执行                                      ║
╚═══════════════════════════════════════════════════════════╝
    ├─ checklist gate 未过 → 停下问用户（yes/no）
    ├─ 阶段串行 / [P] 并行 / 同文件串行 / 非并行失败 halt
    └─ 完成实时标记 [X] 回写 tasks.md
        ↓
    （可选）taskstoissues → 校验 remote 为 GitHub 后建 issue
```

> 横切层：`extensions.yml` 在每命令头尾注入 before_/after_ 钩子（缺失静默降级）；模板按 `overrides → presets → extensions → core` 运行时栈逐层覆盖；`workflow.yml` 用声明式 steps + `type: gate` 人工评审关卡编排整链。

---

## 优势与劣势

### 优势

- **通用性极强**：一套 SDD 跑遍十余种代理；模板（运行时栈）+ 命令（安装期注册）双向覆盖机制。
- **模块化解耦**：扩展系统让 Jira/Linear 等集成 opt-in，内核保持精简（RFC Motivation "Monolithic Growth"）。
- **质量命令成体系**：`clarify` 结构化消歧、`checklist` 需求质量门、`analyze` 一致性裁决三件套互补。
- **官方维护、迭代活跃**，文档/RFC 完整。

### 劣势

- **工程税重**：扩展 manifest / catalog / preset 优先级栈 / 多代理适配，对单人单代理场景是纯负担。
- **命令体偏"指令文档"**：每个命令把 hook 检查的 if/else 全文写进 prompt，模型需逐条解释执行，token 与误执行风险高。
- **缺机械判级**：复杂度判断全靠模型读 prompt 自判，无"计分→档位"的确定性闸门。
- **无业务知识沉淀层**：没有跨需求复用的领域知识库。

---

## 值得学习的实现机制

> 与借鉴裁决解耦：本节只回答「值不值得学习」，不回答「是否搬进 soso-kit」。每条附目标项目源码 `file:line`，不出现 ✓/✗/~ 与「soso-kit 已有/缺失」判断。

### 机制 1：结构化歧义分类法扫描

- **解决什么问题**：spec 的"哪里没说清"通常靠模型自由发挥，召回不稳、易漏高影响项。
- **怎么实现**：`clarify.md:223-273` 用 11 类固定 taxonomy（Functional Scope / Domain&Data / Interaction&UX / Non-Functional / Integration / Edge Cases / Constraints / Terminology / Completion Signals / Misc）逐类标 `Clear / Partial / Missing` 形成内部 coverage map，再以 `(Impact × Uncertainty)` 启发式排序、全程封顶 5 问（`clarify.md:288`）。
- **可迁移的思想内核**：把"开放式找问题"降维成"对固定维度矩阵打状态 + 量化排序"，让覆盖度可度量、提问可预算。

### 机制 2：Recommended-option 单问交互

- **解决什么问题**：澄清问题一次性抛一堆、且要用户从零作答，决策摩擦高、易敷衍。
- **怎么实现**：`clarify.md:290-323` 一次只问一个问题、禁止预告后续；每个选择题先给 `**Recommended:** Option X - 理由`，用户回 "yes/recommended" 即采纳推荐答案，否则给字母或 ≤5 词自定义。
- **可迁移的思想内核**：交互式澄清应"模型先给带理由的默认值、人只做确认或否决"——把人的成本从"生成答案"降到"审一个答案"。

### 机制 3：增量原子回写 + 低噪声状态同步

- **解决什么问题**：长澄清过程中途丢上下文会前功尽弃；机械刷新质量勾选会制造大量无意义 diff。
- **怎么实现**：`clarify.md:326-340` 每答一题立即把结论写回 spec 对应 section + `## Clarifications / ### Session YYYY-MM-DD` 记录，每次 atomic overwrite；`clarify.md:362-366` 重评 checklist 时**只 toggle 状态真正变化的复选框、保留原大小写**，其余内容（标题/顺序/空白）一字不动。
- **可迁移的思想内核**：长流程产物要"边产出边落盘"防丢失；自动改文件要"最小变更"以保持 diff 可读、可信。

### 机制 4："Unit Tests for English"——需求质量门

- **解决什么问题**：质量检查容易滑向"测实现是否工作"，而真正的早期风险是"需求本身写得好不好"。
- **怎么实现**：`checklist.md:1042-1061` 明确 checklist 是"给英文需求写的单测"，只评需求的完整性/清晰度/一致性/可测量/覆盖；`checklist.md:1264-1278` 给出禁用动词黑名单（Verify/Test/Confirm/Click/render/load…）与必用问句句式（`Are X defined? / Is X quantified?`）。
- **可迁移的思想内核**：把质量门前移到"规格文本"这一层，并用"问需求是否写清"取代"测系统是否工作"，能在写代码前拦住最贵的错误。

### 机制 5：强制溯源 + 质量维度标签

- **解决什么问题**：质量条目泛泛而谈，无法定位到具体规格位置，复查时不可追溯。
- **怎么实现**：`checklist.md:1207-1248` 要求每条带质量维度标签 `[Completeness/Clarity/…]` + 溯源引用 `[Spec §X.Y]` 或缺口标记 `[Gap]/[Ambiguity]/[Conflict]`，且**≥80% 条目必须含溯源**；软上限 40 条、超出按 risk/impact 优先并合并近似项。
- **可迁移的思想内核**：任何"发现/判断"都应携带回指原文的坐标和分类标签，使结论可核查、可去重、可按影响裁剪。

### 机制 6：确定性只读裁决 + 语义建模覆盖映射

- **解决什么问题**：跨产物（spec/plan/tasks）的不一致与覆盖缺口靠人眼很难穷举，且每次结论漂移。
- **怎么实现**：`analyze.md` 先把 FR-###/SC-### 抽成稳定 key + imperative-slug 建 requirements inventory，再映射到 task IDs，跑 6 类检测 pass（重复/歧义/欠规范/宪法对齐/覆盖缺口/不一致）；明确要求"同输入重跑产出一致的 ID 和计数"（Deterministic results），且 SC 只纳入"需要 buildable work 的项、排除业务 KPI"。
- **可迁移的思想内核**：让分析输出像编译器一样**确定、可 diff**，并把"需求—任务"做成显式映射表而非凭感觉判断覆盖。

### 机制 7：严重度分级 + 不可协商项自动顶格

- **解决什么问题**：发现一堆问题但不分轻重，用户不知道哪些必须先解决。
- **怎么实现**：`analyze.md` 用 CRITICAL/HIGH/MEDIUM/LOW 启发式分级，并规定**违反宪法 MUST 一律自动 CRITICAL**，限 50 findings + 溢出汇总。
- **可迁移的思想内核**：把主观"这个挺严重"转成有规则的分级，并为"红线类问题"设自动顶格通道，避免它被淹没在长列表里。

### 机制 8：宪法语义化版本 + 同步传播报告

- **解决什么问题**：项目原则改了，但依赖它的模板/命令还停在旧版本，造成"文档漂移"。
- **怎么实现**：`constitution.md:68-93` 规定宪法改动按 MAJOR/MINOR/PATCH 语义化版本 bump（含理由），并以 HTML 注释 prepend 一份 **Sync Impact Report**（版本变化 + 哪些下游模板需同步，`✅ updated / ⚠ pending` 带路径）；`constitution.md:80-85` 强制改完回查 plan/spec/tasks 模板与所有命令文件是否仍对齐。
- **可迁移的思想内核**：单一事实源（SSOT）发生变更时，应自带"版本号 + 受影响清单 + 回查动作"，把漂移消灭在改动当时。

### 机制 9：Complexity Tracking——强制复杂度举证

- **解决什么问题**：方案引入额外复杂度（多一层、多一个项目、多一个模式）往往无人质疑。
- **怎么实现**：`plan-template.md` 的 `## Complexity Tracking` 表要求：每个违反宪法的复杂度必须填「为什么需要」+「为什么更简单方案被否」，否则不许引入。
- **可迁移的思想内核**：把复杂度当作需要书面举证的"债务"，用"必须写下为何不用更简方案"来对抗过度设计。

### 机制 10：跨代理元设计（占位符 / handoffs / 双脚本 / fail-safe 钩子 / 覆盖栈）

- **解决什么问题**：要让"一份命令逻辑"同时服务多种代理、并允许第三方扩展而不污染内核。
- **怎么实现**：
  - 命令体不硬编码 `/speckit.plan`，用 `__SPECKIT_COMMAND_X__` 占位符，安装期按代理替换（claude 用 `/`、codex 用 `$`）（`specify.md`）。
  - 每命令 frontmatter 声明 `handoffs`（下一步命令 + 预填 prompt + `send:true`）与 `scripts`（sh + ps 双实现，输出 JSON 供命令体解析）。
  - hook 生命周期 before_/after_ 在每命令头尾检查，解析失败/缺失静默降级，且**条件表达式不交模型评估**而留给确定性执行器（所有命令 Pre/Post hooks 段）。
  - 模板按 `overrides → presets(优先级) → extensions → core` 运行时解析栈逐层覆盖，未装 preset 行为与从前完全一致（`presets/README.md`）。
- **可迁移的思想内核**：用"占位符解耦引用 + 元数据描述工作流边 + 机械操作交脚本 + 扩展点优雅降级 + 分层覆盖零回归"这套组合，可让一套流程既通用又可扩展。

### 机制 11：不可逆外部操作的双重护栏

- **解决什么问题**：把任务写成 GitHub issue 这类外部副作用一旦写错仓库，难以撤回。
- **怎么实现**：`taskstoissues.md:1463-1469` 建 issue 前强制校验 git remote 是 GitHub URL，并用两段 `> [!CAUTION]` 重申"绝不在与 remote 不匹配的仓库建 issue"。
- **可迁移的思想内核**：对不可逆外部写操作，应在执行前显式校验目标并以醒目护栏复述禁止条件，宁可啰嗦。

---

## 与 soso-kit 对比

> 对比基于自画像，仅作方向判断。「soso-kit 是否已有 / 是否需要」必须落到源码（见借鉴建议第 0 问）。

| 维度 | spec-kit | soso-kit | 启发 |
|------|----------|----------|------|
| SDD 内核 | constitution/specify/plan/tasks/implement | clarify/spec/plan/task/check/commit/pr | 同源，soso-kit 更细 |
| spec 模板 | P1/P2/P3 + 独立可测 + 技术无关指标 | 已具备（`spec-template.md` 用户故事 P1🎯MVP + FR MUST/SHOULD/MAY） | 已对齐 |
| 跨产物一致性 | `analyze` 合并只读报告（FR→task 矩阵 + 严重度，advisory） | 分布式：plan COVERAGE(**未覆盖→硬阻断**) + check CHK-04c + review | soso-kit 硬阻断强于 spec-kit 分级建议 |
| 复杂度判级 | 模型读 prompt 自判 + Complexity Tracking（自陈两列） | VERDICT 机械计分 + SELF-AUDIT「≥2 具体场景」 | soso-kit 证据级 forcing 更狠 |
| 项目定制 | preset 运行时覆盖栈 + extensions | `rules/modules/<project>` + `kit/projects/` + check 过滤块 | 各自实现，需求已满足 |
| 多代理 | 十余种 | 单代理（设计选择） | 范围不同 |
| 领域知识 | 无 | 4 层 Context Library | soso-kit 独有 |
| 编排 | workflow.yml 声明式 gate | 命令链 + HARD-GATE | 各自够用 |

---

## 借鉴建议

> 零假设 = 不借鉴。任何 ✓/~ 必须附 soso-kit 源码 `file:line`（证明缺失）或实测输出；拿不出标 `[推理]` 并降级。

分析质量四问已过（信息充分：读完全部 9 个命令实现 + plan/spec/tasks 模板 + 扩展/preset 架构；依据均指向 soso-kit 源码行号；非武断全否，保留 2 个边际项；下钻到实现差异层）。

### 0. 零假设校验（先答）

默认结论 = 不借鉴，逐候选附 soso-kit 源码证据：

- **扩展/Hook 插件系统**：soso-kit 现状 `.claude/rules/modules/<project>/` + `.claude/kit/projects/<project>/`（项目隔离已实现）→ 单人工具无第三方集成生态压力（伪需求）→ 过度设计。
- **Presets 覆盖栈**：soso-kit 现状 `.claude/kit/check/scripts/check.sh:40-66` filter_checklist 按 `<!-- project: -->` 块过滤 + `rules/modules/` → 等价能力已有 → 过度设计。
- **多代理集成**：soso-kit 现状 全栈基于单代理 → 设计边界外（非问题）→ 跳过。
- **workflow.yml 声明式 gate**：soso-kit 现状 `.claude/commands/k/plan.md:512`、`.claude/kit/check/templates/checklist.md:54` 的 `⛔ HARD-GATE` 链式拦截 → 无真实痛点 → 边际。
- **合并式只读 analyze 报告（FR→task 矩阵 + 严重度）**：soso-kit 现状 `.claude/commands/k/plan.md:506` COVERAGE 表对任何 ⚠️未覆盖**直接 HARD-GATE 硬阻断**（不得流转），强于 spec-kit 的「分级建议报告」（advisory）；FR-### 编号化是纯装饰，现有"关键需求条目→步骤"已能定位遗漏 → **已有更强等价 → ✗**（经源码复核，原「边际补充」降级）。
- **模糊形容词 lint**：soso-kit 现状 `.claude/commands/k/spec.md:298` 内部一致性自审 + `/k:clarify` 模糊度语义评估已覆盖"无量化形容词"这一子集；显式词表是冗余形式化，LLM 语义判断本就能识别 fast/secure 缺指标 → **冗余 → ✗**（经源码复核，原「边际补充」降级）。

### 1. 对 soso-kit 帮助大吗？

**接近零**。spec-kit 的 SDD 内核与 spec 模板规范，soso-kit 已全部具备甚至更细（VERDICT 机械计分、Context Library、跨栈红线均为 spec-kit 所无）。spec-kit 近一年净新增（扩展/preset/多代理）服务的是"通用框架"目标，与 soso-kit"单人 + 业务沉淀"定位正交。

初判的两处疑似边际项，**经回 soso-kit 源码复核后均被否**（见第 0 问）：

- `analyze` 的 FR 覆盖矩阵 + 严重度 → soso-kit COVERAGE 已对未覆盖 **HARD-GATE 硬阻断**（`plan.md:506`），比"分级建议"更强，无须借。
- 模糊词表 → soso-kit 语义模糊度评估已覆盖（`spec.md:298` / `/k:clarify`），词表冗余。
- 命令级复核另发现：`plan.md:441-442` SELF-AUDIT 要求新抽象"**≥2 个具体使用场景**"+ speculative 抽象降级 TODO，是**证据级** forcing，强于 spec-kit `Complexity Tracking` 的自由文本"why simpler rejected"。

唯一残留极小增量：`/k:clarify` 提问选维靠"模糊度评估"（`clarify.md` Step 2），可显式化为 Clear/Partial/Missing 覆盖矩阵以提可审计性——但交互式逐问已部分覆盖，收益微。

### 2. 有必要吗？

**不必要**（主体）/ **非必要但可选**（2 个边际项）。插件化/preset/多代理对单人工具是纯负债，明确不做。两个边际项收益极小，不值得专门改动，可在未来顺手优化时纳入。

### 3. 更新后能提升哪些？

- ⚠️ 不提升：扩展系统、presets、多代理、workflow.yml —— 均与定位冲突或已有等价物，不涉及。
- ⚠️ 不提升：analyze FR 矩阵 + 严重度 —— soso-kit COVERAGE 已 HARD-GATE 硬阻断（`plan.md:506`），FR 编号化纯装饰，**不多抓一个遗漏**。
- ⚠️ 不提升：模糊词表 —— 语义评估已覆盖（`spec.md:298`），冗余形式化。
- ⚠️ 不提升：复杂度举证 —— soso-kit SELF-AUDIT「≥2 具体场景」（`plan.md:441`）已是证据级 forcing，强于自陈式两列表。
- ◽ 仅可选极低：`/k:clarify` 选维显式化为覆盖矩阵（可审计性微增）。

### 4. 结论

**不做**（经源码复核，初判的边际项全部归零）。

- 分级：过度设计（扩展/preset/多代理/workflow）+ **伪增益**（analyze 矩阵、模糊词表、复杂度举证——soso-kit 已有等价或更强）+ 可选极低（clarify 覆盖可见性）。
- 成本/收益：无值得投入项；唯一极低增量（clarify 覆盖矩阵）收益微、非必要。

**一句话**：soso-kit 是 SDD 内核在单人场景的成熟特化超集——在**执行取证 / 机械判级 / 覆盖硬阻断 / 防过度抽象**几条轴上比 spec-kit 更狠；spec-kit 强在通用性 / 可扩展 / 多代理（与 soso-kit 定位正交）。命令机制**无可落地借鉴**；真正价值在「值得学习的实现机制」节——读懂设计思想，而非搬命令。

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~2200 tokens |
| 分析阶段 | ~14000 tokens |
| 文档阶段 | ~7100 tokens |
| **总计** | **~23300 tokens** |

---

## 变更记录

- 2026-05-31: 首次分析（含「值得学习的实现机制」逐命令提炼）
- 2026-05-31: 核心流程改为三段式（全景图 → 速查表 → 管道图，各配串场文案），对齐 study v1.6 规范
- 2026-05-31: 命令级源码复核后修正借鉴裁决——analyze 矩阵 / 模糊词表 / 复杂度举证均降级为伪增益（soso-kit COVERAGE 硬阻断、SELF-AUDIT「≥2 具体场景」已等价或更强），借鉴归零
