# Study: OpenSpec

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/Fission-AI/OpenSpec.git |
| 分析日期 | 2026-05-31 |
| Commit | 9aded17 |

---

## 📊 借鉴裁决

> 分析质量四问：**已过**（信息充分性经补读 `archive.ts` 活规格闭环 + `specs-apply.ts` delta 合并 + `requirement-blocks.ts` delta 解析 + `instruction-loader.ts` 注入组装 + `project-config.ts` per-artifact rules 达成；全部判断已落到双方源码行号，非抽象摘要）。

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ~ Delta 原则 → Context 演进   → 已落地(commit e389aea / context v2.12.0)：结构化 history + 防丢/防坏双闸
  ~ 规则的上下文感知注入       → 待办：soso-kit modules/(6项目) 全量 always-on，可按当前仓裁剪
  ✗ Delta 整套机制（强格式）    → 不搬：人读文档套机器 schema 会 silent-fail；只借原则不搬机制
  ✗ Schema 驱动 DAG 引擎        → 过度设计：固定线性管线已有 VERDICT 条件分支
  ✗ 指令/模板外置可编辑         → 已有：kit/templates/*.md + commands/k/*.md 本就可即时编辑
  ✗ Fluid actions not phases    → 已有等价：各命令独立可重入
  ✗ 跨编辑器 adapter 生成       → 过度设计：soso-kit 专注单编辑器
  ✗ CLI --json 供 AI 取数       → 已有，且是 soso-kit 立身核心
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总体：两者核心理念高度同构（外置指令、文件即状态、CLI 取数）。OpenSpec 的独有抽象（schema/DAG/
        多编辑器）服务于「不可改源码的发布型工具」，在 soso-kit「config 即源码、单编辑器」模型下不需要。
        实际收获两点：① delta 的三条「原则」（完整块防丢 / 写入前校验 / 结构化变更记录）已嫁接到
        Context 差量更新并落地；② 规则按项目裁剪注入（待办 token 优化）。delta 的强格式「机制」不搬。
```

---

## 核心思想与原则

OpenSpec 是 spec-driven development 的工作流框架（npm 包 `@fission-ai/openspec`）。哲学（README）：`fluid not rigid / iterative not waterfall / brownfield not just greenfield`。

新一代 OPSX 工作流的核心信条（`docs/opsx.md:48-57`）：

- **Actions not phases** — create / implement / update / archive 任意顺序，依赖是「使能器」不是「门」。
- **Schema 即一切** — 工作流由外部 YAML schema 定义，用户编辑 `schema.yaml` / `templates/*.md` 即时生效，无需等版本发布（`docs/opsx.md:27-37`）。
- **状态 = 文件存在性** — 不维护阶段状态机，artifact 是否完成只看文件是否生成（`src/core/artifact-graph/state.ts:14-29`）。

设计动机（`docs/opsx.md:13-19`）：legacy 工作流把指令硬编码在 TypeScript 里、一次性创建全部产物、结构固定、黑盒不可调。OPSX 把这一切外置，让终端用户能改。

## 核心流程

1. **Schema 定义 artifact DAG**（`schemas/spec-driven/schema.yaml:4-147`）：`proposal → specs → design → tasks`，每个 artifact 带 `requires` / `generates` / `instruction` / `template`。
2. **依赖图引擎**（`src/core/artifact-graph/graph.ts`）：Kahn 算法拓扑排序（L72-113）、`getNextArtifacts` 算就绪节点（L118-134）、`getBlocked` 算阻塞依赖（L151-166）。
3. **查询式信息流**（`docs/opsx.md:486-518`）：agent 调 `openspec status --json` 拿状态 → `openspec instructions <id> --json` 拿富指令（含模板 + 依赖路径 + 解锁项）→ 只生成一个 artifact。
4. **活规格闭环**（核心）：变更目录 `changes/<name>/` 下的 delta spec 用 `ADDED / MODIFIED / REMOVED / RENAMED` 显式标记（`schema.yaml:41-79`）；`archive` 时 `findSpecUpdates` 把 delta 合并回主规格 `openspec/specs/`，归档前 `validateSpecContent` **校验重建后的完整 spec，失败拒绝写入**（`src/core/archive.ts:201-244`）。proposal 是临时的（归档进 `archive/`），spec 是永久累加演进的真相源。
5. **per-artifact 注入**（`src/core/project-config.ts:26-40`）：`config.yaml` 的 `context`（全局项目上下文，注入所有 artifact）+ `rules`（按 artifact ID 注入，仅匹配 artifact 可见），带 50KB 上限校验（L96-105）；`instruction-loader.ts` 把 context + rules + template 三段拼装。
6. **跨编辑器生成**（`src/core/command-generation/adapters` + `profile-sync-drift.ts:14-26`）：单一 schema 源 → 各编辑器（Claude Code / Cursor / Windsurf）的 skill / command 文件，并检测生成物与源的漂移。

## Spec Delta 深度机制（核心创新详解）

OpenSpec 最有借鉴价值的机制。**数据模型双层**：

- **主规格** `openspec/specs/<capability>/spec.md` — 系统行为的持久契约，由 `### Requirement:`（每块含若干 `#### Scenario:`）构成，是「当前真相」。
- **delta** `changes/<name>/specs/<capability>/spec.md` — 只描述本次变更，4 个操作 section：`## ADDED / MODIFIED / REMOVED / RENAMED Requirements`。

**一次变更的生命周期（声明式 delta → 机器合并）**：

1. **写 delta**：标注每个 requirement 的操作。`MODIFIED` 必须粘贴**整块完整新内容**（不是 diff 片段，`schema.yaml:54-60` 警告 partial 会丢内容）。
2. **解析** `parseDeltaSpec`（`requirement-blocks.ts:119-125`）：按 4 个 section header 切块，提取 requirement 块（raw 文本 + 规范化 name）。
3. **冲突检测** `findSpecUpdates`（`specs-apply.ts:119-184`）：同 section 重名报错；跨操作冲突（MODIFIED+REMOVED / MODIFIED+ADDED / ADDED+REMOVED 同名）报错；RENAMED 交互校验（MODIFIED 须引用 NEW header）；新 spec 只允许 ADDED。
4. **合并应用**（`specs-apply.ts:244-310`）：主规格解析成 `nameToBlock` map，按**固定顺序 RENAMED → REMOVED → MODIFIED → ADDED** 施加。MODIFIED 整块替换且 header 必须匹配（`:287-293` 防错位替换）。
5. **重建 + 校验**：重组完整主规格 → `validateSpecContent` 校验 → **失败拒绝写入**（`archive.ts:240-244`）。
6. **archive**：delta 合并进主规格后，change 归档到 `archive/<date>-<name>/`，主规格完成一次演进。

**本质**：spec 即代码、变更即 PR、archive 即 merge——确定性脚本机器合并 + 重建校验保证一致性。

## 优势与劣势

### 优势

- Schema 外置 → 终端用户能自定义工作流，对「不可改源码的发布型工具」是关键解锁。
- 文件存在性即状态 → 无状态机，天然支持中途回改、重入。
- 活规格闭环 + 重建校验 → spec 演进可追溯，机器拦截「MODIFIED 丢内容」「场景井号写错静默失败」等格式错误（`schema.yaml:51,60` 自承风险）。
- per-artifact rules 注入 → 上下文按产物精准裁剪，避免无关规则占 token。

### 劣势

- DAG / 拓扑引擎对线性管线（spec-driven 实际就是一条链）是重机械。
- spec 格式约束苛刻（`####` 用 3 个井号即 silent fail），强依赖 validator 兜底。
- 跨编辑器 adapter 带来持续维护面。

## 与 soso-kit 对比

> 对比已落到双方源码（非自画像）。

| 维度 | OpenSpec | soso-kit | 实现差异 |
|------|----------|----------|----------|
| 工作流定义 | 外部 YAML schema（用户可改） | `commands/k/*.md` + `kit/templates/*.md`（本就可改） | soso-kit 用户即作者，无需 schema 抽象层 |
| 步骤编排 | DAG + 拓扑排序引擎 | 固定管线 + `complexity-score.sh` VERDICT 条件跳过 | 固定线性管线无需 DAG |
| 状态判断 | 文件存在性 | 实跑 git / tool 取真值 | 理念一致，soso-kit 更进一步（反「记忆作 ground truth」） |
| AI 取数 | CLI `--json` 查询 | 脚本输出 JSON / 计数 / 退出码，工作流消费 | 完全同构 |
| 制品演进 | delta 临时态 → archive 合并回主 spec + 重建校验 | `context-update.md` history 累加 + 差量更新 reference（已补 P1/P2/P3 三原则） | 都有演进闭环；delta 的三条原则已嫁接到 Context（commit e389aea），但强格式机制不搬（reference 是人读 md） |
| 规则注入 | per-artifact rules（按 ID 注入）+ 全局 context | `essential/` + 全部 `modules/`(6 项目) 经宿主配置全量 always-on | **OpenSpec 更精细** ← 唯一借鉴点 |
| 目标编辑器 | 多编辑器 adapter | 单编辑器 | 范围不同 |

## 借鉴建议

> 零假设 = 不借鉴。任何 ✓ / ~ 附 soso-kit 源码 `file:line` 或实测输出。

### 0. 零假设校验（先答）

默认结论 = 不借鉴。逐候选附 soso-kit 源码证据：

- **规则上下文感知注入**：soso-kit 现状——`.claude/rules/modules/` 下 `exp-ads / sodex-admin-dashboard / sodex-biz / sodex-lens / sodex-next / sodex-web` 六个项目规则经宿主配置**全量 always-on 注入**（实证：一次 soso-kit 内部任务即同时注入了 sodex-lens StarRocks SQL 规则、sodex-web 精度计算、sodex-next auth capability 等全部无关规则）→ **真问题**（可指证的 token 常驻浪费）→ **边际补充**（token 优化，非能力新增；命令层 `commit.md`/`figma.md` 已有按需引用 `rules/` 雏形）。
- **Schema 驱动 DAG 引擎**：soso-kit 现状 `kit/spec/scripts/complexity-score.sh`（VERDICT 机械评分驱动 simple/medium/complex 条件分支）+ 管线固定线性 → 伪需求 → **过度设计**。
- **指令/模板外置**：soso-kit 现状 `kit/templates/*.md` + `commands/k/*.md` 全是即时生效 markdown → 已有 → 重复造轮子。
- **Fluid actions / 状态=文件存在**：soso-kit 各命令独立可重入 + 实跑判断状态 → 已有等价 → 重复。
- **Delta 整套机制（强格式 + 脚本合并）**：OpenSpec 的 4-section 强格式 + 脚本机器合并（`specs-apply.ts`）针对被机器解析的 spec；soso-kit reference 是人读 md，套强格式会 silent-fail 且无脚本合并刚需 → **机制不搬**（过度设计）。
- **Delta 三条原则 → Context 差量更新**（深挖后新增，**已落地**）：把 delta 验证过的原则嫁接到 Context 已有的机器结构（router sections / lineRange / `AFFECTED_SECTIONS` / `validate-sections`），而非移植机制。三点见下「Delta → Context 借鉴落地」专节 → **真问题 + 已实现**（commit e389aea / context v2.12.0）。
- **跨编辑器 adapter**：soso-kit 专注单编辑器 → 范围扩张非核心提升 → 过度设计。
- **CLI `--json` 取数**：soso-kit 脚本输出 JSON / 退出码、工作流编排消费本就是核心机制 → 已有。

### 1. 对 soso-kit 帮助大吗？

**小**。6 个候选中 4 个已有等价（模板外置、可重入、JSON 取数、演进闭环），2 个过度设计（DAG、多编辑器），仅 1 个（规则注入）指向真实缺失。

根因：两者目标用户不同。OpenSpec 是**发布型 npm 工具**，用户无法改其 TS 内核，必须发明「schema 外置」让用户自定义；soso-kit 是**用户直接编辑的 config 源**，schema 抽象层多余。

### 2. 有必要吗？

**非必要但推荐**（仅限规则注入这一点）。引入 DAG / schema 层只会在固定管线上叠机械复杂度，违反「严格 ≠ 繁琐」与「路径最短」；但「按当前项目裁剪规则注入」是实打实的 token 收益，值得做。

### 3. 更新后能提升哪些？

- ✅ token 常驻成本：`modules/` 改为**按 git 主仓名只注入对应 `modules/<project>/`**（soso-kit 本就用主仓名识别项目），省下其余 5 个项目规则的常驻 token。
- ⚠️ 不提升：工作流编排（VERDICT 条件分支已优于 DAG）、状态判断（实跑 git 强于文件存在性）、制品演进（已有 history + 差量更新）、AI 取数（已是核心）。

### 4. 结论

**部分做**——仅落地「规则的上下文感知注入」一项：

- 落地方式：调整注入策略，按当前仓库主名只注入对应 `modules/<project>/`，而非全部 6 个项目全量常驻。复用命令层已有的 `rules/` 按需引用机制（`commit.md`/`figma.md`）扩展到 modules。
- 分级：**边际补充**（token 优化，非能力新增）。
- 成本：改注入策略，无新增常驻。
- 收益：每次推理省下无关项目规则的 token。

其余 5 项 **不做**（已有 / 过度设计 / 不适用）。

**一句话**：OpenSpec 与 soso-kit 同领域、不同分发模型，核心理念高度同构。深挖后实际收获**两点借鉴**：① delta 的三条原则（完整块防丢 / 写入前校验 / 结构化变更记录）已嫁接到 Context 差量更新并**落地**（commit e389aea）；② 规则按项目裁剪注入（待办 token 优化）。delta 的强格式机制、schema/DAG/多编辑器抽象在 soso-kit 模型下不适用。

## Delta → Context 借鉴落地（已实现）

> 本次 study 唯一真正落地的借鉴。关键：借 delta 的**原则**，不搬它的**机制**。

**背景**：spec delta 服务「长期机器契约的安全演进」。该职责在 soso-kit 由 Context Library（非 spec）承担，已有 section 粒度差量（`context-update.md` Step 4）。但对照 delta 暴露出 Context 三个薄弱点，且修复手段是把原则嫁接到已有机器结构（router sections / lineRange / `AFFECTED_SECTIONS` / `validate-sections`），而非引入强格式：

| 点 | 借 delta 的原则 | Context 落点 | 实现位置 |
|----|----------------|-------------|---------|
| **P3** | 结构化变更记录 | history 条目加 `sections`(op) + `symbols`，复用 `AFFECTED_SECTIONS` + outline diff | `append-history.sh` 加 `--sections-file`/`--symbols-file`；Step 6c 接入 |
| **P1** | MODIFIED 完整块防丢 | Step 4b 完整块纪律 + 行数 <70% 兜底回查 | `context-update.md` Step 4b |
| **P2** | 写入前重建校验拒写 | Step 4d grep 骨架对比，结构漂移拒绝定稿 | `context-update.md` 新增 Step 4d |

**提升（实测验证）**：history 从「代码文件流水账」升级为可机器溯源的 section/符号级演进索引——支持「某 section 被哪几次变更动过」「某符号哪次引入」查询；差量改写补上「防丢内容 + 防坏骨架」双闸。**全部向后兼容**（旧调用/旧条目不受影响；record 首次路径暂不带结构化字段）。

**成本**：P3 几乎零增量（复用已算产物 + 填充已有字段）；P1/P2 是纪律 + 零 token shell 校验。

**为何只借原则不搬机制**：delta 的价值锚定「机器解析 → 脚本合并 → 重建校验」链；soso-kit 的 reference / Context 是人读自由 md，不在该链上，套强格式只会增加格式负担（井号写错 silent-fail）却换不来脚本合并的刚需（Context 合并靠工具差量改写 + 人审）。

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~1900 tokens |
| 分析阶段（含多轮修正补读 spec delta 机制） | ~14000 tokens |
| 文档阶段（含补全细节） | ~4500 tokens |
| **总计** | **~20400 tokens** |

## 变更记录

- 2026-05-31: 首次分析（初版结论「零借鉴」因依据引自自画像、未读核心闭环而被推翻；经补读 archive/instruction-loader/project-config 源码后修正为「1 项边际借鉴 + 5 项跳过」）
- 2026-05-31: 补全细节（深读 `specs-apply.ts`/`requirement-blocks.ts` 后补「Spec Delta 深度机制」专节；delta 由「不适用」修正为「机制不搬、三条原则已嫁接到 Context 并落地」——新增「Delta → Context 借鉴落地」专节，对应 commit e389aea / context v2.12.0；裁决与对比表同步）
