# Study: mattpocock/skills

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/mattpocock/skills |
| 分析日期 | 2026-05-21 |
| Commit | b8be62f |
| 类型 | Claude Code 1.0+ Skills 集合 |
| 形态 | 14 个生产级 SKILL.md（engineering / productivity）+ 4 个 in-progress + 4 个 personal |
| 作者 | Matt Pocock（TypeScript 教育者，AI Hero 创始人）|

---

## 核心思想与原则

### 修复 agent 四大失败模式（README 主线）

| # | 失败模式 | 引用 | 解法 |
|---|---------|------|------|
| 1 | 没做对 | Pragmatic Programmer | grill 系列（强制对齐）|
| 2 | 太啰嗦 | DDD（Eric Evans）| CONTEXT.md 共享语言压缩 token |
| 3 | 代码不 work | Pragmatic Programmer | feedback loop（diagnose / tdd）|
| 4 | 大泥球 | XP（Kent Beck）+ Ousterhout | improve-codebase-architecture |

### 九个机制级元思想（深读后提炼）

#### 机制 #1: Interface = Test Surface = AI Navigation Surface

`LANGUAGE.md` 原文："The interface is the test surface."

更深一层：**接口同时是 AI 探索代码的入口**。深模块（小接口、大实现）→ AI 用更少 token 理解一大块行为 → 测试也用同一面板。这把"代码设计"和"AI 可用性"统一成一个原理。

#### 机制 #2: Soft Dependency vs Hard Dependency（ADR-0001 核心设计）

```
Hard dependency (to-issues / to-prd / triage)
  → 缺配置 = 输出错误 → 必须显式 pointer
  → "should have been provided to you — run /setup-matt-pocock-skills if not"

Soft dependency (diagnose / tdd / improve-codebase-architecture / zoom-out)
  → 缺配置 = 输出稍弱 → 仅 vague prose 提及
  → "use the project's domain glossary"
```

ADR-0001 原文："The split keeps soft-dependency skills token-light and avoids cargo-culting the setup pointer into places where it isn't load-bearing."

**这是 token 经济学的元设计**。

#### 机制 #3: Deletion Test 作为通用判断器

`LANGUAGE.md`："imagine deleting the module. If complexity vanishes, the module wasn't hiding anything (it was a pass-through). If complexity reappears across N callers, the module was earning its keep."

不只判断代码模块，是判断**任何"间接层"是否 earning its keep** — 命令、文档、抽象层都适用。

#### 机制 #4: Tracer Bullet（垂直切片）贯穿全套技能

| Skill | 表现形式 |
|---|---|
| to-issues | 每个 issue = vertical slice through all layers |
| tdd | 每 cycle = test+impl 配对（反对"先写全部测试再实现"）|
| diagnose | 每 hypothesis = 一个可证伪 probe |
| prototype | 单一问题、最小 TUI |

反模式叫 **horizontal slicing**：批量写测试 / 批量列任务 / 批量探索 → 产出 vibe-coded 实现。

#### 机制 #5: Lazy Creation 一以贯之

CONTEXT.md / docs/adr/ / docs/agents/ / .out-of-scope/ — 所有支持文件**等第一次有内容才创建**。grill-with-docs 原文："Create files lazily — only when you have something to write."

不是"先 init 一套骨架等用户填"，是"写时才生"。

#### 机制 #6: Two-Axis Review（双轴评审）+ 并行 sub-agent

review skill 把代码评审拆成 Standards / Spec 两个独立 axis，并行 sub-agent 跑，**不合并、不重排**。

核心洞察："Code that follows every standard but implements the wrong thing → Standards pass, Spec fail. Code that does exactly what the issue asked but breaks the project's conventions → Spec pass, Standards fail."

#### 机制 #7: Agent Brief = 耐用 Spec

triage 产出的 agent brief 强调 **durability over precision**：
- ❌ 不写 file path / line number（spec 躺几天/几周后会过时）
- ✅ 写 interface / behavior / acceptance criteria（耐用）

#### 机制 #8: HITL / AFK 二元标注

每个 vertical slice 必须标 HITL（人在回路）或 AFK（agent 可独立完成）。**把 agent 自主性显式建模**。

#### 机制 #9: 共享语言作为 token 压缩器

CONTEXT.md domain glossary 不只是文档，是**让 AI 与人共享同一个词典**：
- 变量名、文件名、AI 思考都用同一组词
- 减少 AI 同义词飘移（"deposit" vs "充值" vs "fund"）
- 减少 token（一个词代替一段解释）

README 原文："The agent also spends fewer tokens on thinking, because it has access to a more concise language."

---

## 核心实现原理：Claude Code Skills 协议 + Progressive Disclosure

> 这是 mattpocock/skills 真正的工程基础。所有"机制级"思想都建立在这一层上。

### 协议层（Claude Code 1.0+ 内置）

mattpocock 没有自己实现注入机制，他**选了对的协议层** — Claude Code 1.0+ 的 Skills 系统。

```
~/.claude/skills/<skill-name>/SKILL.md   ← 安装位置（通过 link-skills.sh symlink）
       │
       ├── frontmatter（name + description）  ← Claude 启动时只读这个
       │
       └── 正文 + 子文件                       ← 触发匹配才读取
```

**关键事实**：
- Claude Code 启动时**只把所有 description 放进 system prompt**（约 1500 token 总和 / 14 skills）
- SKILL.md 正文**不进 context**
- 对话中 Claude **自己判断**哪个 description 匹配当前输入 → 主动 Read 完整 SKILL.md
- 这叫 **model-invoked skill**

### 触发识别：description 的 "Use when" 子句

description 不只描述 skill 是什么，更**列出所有触发关键词和场景**：

```yaml
# caveman
description: ...Use when user says "caveman mode", "talk like caveman",
             "use caveman", "less tokens", "be brief", or invokes /caveman.

# diagnose
description: ...Use when user says "diagnose this" / "debug this",
             reports a bug, says something is broken/throwing/failing,
             or describes a performance regression.

# tdd
description: ...Use when user wants to build features or fix bugs using TDD,
             mentions "red-green-refactor", wants integration tests...
```

Claude 在每轮对话开始扫一遍 description，匹配则加载 SKILL.md。

**可禁用自动触发**：`disable-model-invocation: true`（setup-matt-pocock-skills、zoom-out 用了，只允许显式 / 调用）。

### Soft / Hard Dependency 实际写法

**不是技术机制，是 SKILL.md 正文里的两种写法**：

**Hard dependency（强提示）** — `to-prd/SKILL.md:8`、`to-issues/SKILL.md:10`、`triage/SKILL.md:38`：

```
The issue tracker and triage label vocabulary should have been provided to you
— run `/setup-matt-pocock-skills` if not.
```

AI 读到 → 检查环境 → 没有 → 主动告诉用户跑 setup 命令。

**Soft dependency（vague prose）** — `diagnose/SKILL.md:10`、`tdd/SKILL.md:47`、`improve-codebase-architecture/SKILL.md:35`：

```
When exploring the codebase, use the project's domain glossary to get
a clear mental model of the relevant modules, and check ADRs in the
area you're touching.
```

AI 读到 → 尝试找 CONTEXT.md / docs/adr/ → 找不到就 **graceful degrade**（继续工作，输出稍弱）→ 不打扰用户。

### Lazy Creation 实际写法

也**不是自动检测**，是 SKILL.md 正文里的**显式规则**：

`grill-with-docs/SKILL.md:52`：
```
Create files lazily — only when you have something to write. If no
CONTEXT.md exists, create one when the first term is resolved. If no
docs/adr/ exists, create it when the first ADR is needed.
```

`setup-matt-pocock-skills/domain.md:11`：
```
If any of these files don't exist, proceed silently. Don't flag their
absence; don't suggest creating them upfront.
```

机制本质 = **把规则写进 SKILL.md，靠 AI 自觉**。

### 为什么比 always-on 注入好

| 维度 | always-on（soso-kit 当前）| skills 模式（mattpocock）|
|---|---|---|
| 启动注入 | 全部规则进 system prompt（数千-万 token）| 只 description 列表（约 1500 token / 14 skills）|
| 不相关对话 | 规则仍占 context | 不加载该 skill 正文 |
| 触发匹配 | 已在 context | 主动 Read（500-2000 token / skill）|
| Context 窗口 | 长期被规则吃掉 | 干净 |
| AI 注意力 | 被无关规则分散 | 聚焦当前 skill |
| Prompt cache | 规则全在 system prompt，cache 命中 | description 在 system prompt cache；正文按需 cache |

**具体例子**：soso-kit 当前每次对话开头注入 `.claude/rules/modules/sodex-web/` 全量规则 ~15,000 token，但本次对话可能只是问 Figma 样式或写组件 — 其他全浪费。

mattpocock 模式：description 列表 1500 token + 1-2 个触发 skill 正文（2-4k）= **每对话约 5,500 token 注入**。**省 60-70% 注入 token**。

### 哲学差异

```
always-on   = "AI 强制套餐"  — 用户/系统决定吃啥
skills 模式 = "AI 自助菜单"  — Claude 自己点单
```

---

## 核心流程

### Skill 全景

```
engineering/ (10)
├── grill-with-docs         拷问 + inline 写 CONTEXT.md / ADR
├── to-prd                  对话 → PRD（发布到 issue tracker）
├── to-issues               PRD → 多个 vertical slice issue
├── triage                  issue 状态机（needs-triage / needs-info / ready-for-agent / ...）
├── tdd                     红-绿-重构 vertical slice（反 horizontal slicing）
├── diagnose                6-phase 诊断（feedback loop → reproduce → hypothesise → instrument → fix → cleanup）
├── improve-codebase-architecture  深模块审计，HTML 报告
├── prototype               throwaway 原型（logic / UI 二分支）
├── zoom-out                抬高抽象层看代码
└── setup-matt-pocock-skills  per-repo 配置（issue tracker / labels / domain layout）

productivity/ (4)
├── caveman                 token 压缩通信模式（-75%）
├── grill-me                轻量拷问（无 docs 写入）
├── handoff                 会话压缩到 OS 临时目录
└── write-a-skill           创建新 skill

misc/ (4)  - 边缘工具
personal/ (2)  - 作者私用
in-progress/ (4)  - 草稿（含 review）
deprecated/ (4)  - 已废弃
```

### 典型 workflow

```
新任务 → /grill-with-docs（拷问 + 同步 CONTEXT.md/ADR）
      → /to-prd（产出 PRD）
      → /to-issues（拆 vertical slice 发到 issue tracker，标 HITL/AFK）
      → /triage（issue 进入状态机，产出 agent brief）
      → AFK agent 拿起 → /tdd（红-绿-重构 vertical slice）
      → bug → /diagnose（6-phase feedback loop）
      → 定期 → /improve-codebase-architecture（深模块审计）
      → 长会话 → /handoff（压缩供下次接力）
      → token 紧 → /caveman（压缩 75%）
```

### 安装机制

- `.claude-plugin/plugin.json` 注册 14 个 skill（Claude Code 1.0+ Skills 协议）
- `scripts/link-skills.sh` symlink 到 `~/.claude/skills/`
- 通过 `npx skills@latest add mattpocock/skills` 安装

---

## 优势与劣势

### 优势

- **机制层面深**：deletion test / soft-hard dependency / vertical slice / interface=test=AI surface 都是元思想，可跨场景应用
- **token 经济学好**：soft dependency + lazy creation + caveman 多层节省 token
- **文化沉淀**：直接对应 DDD / Pragmatic Programmer / XP / Ousterhout 经典实践
- **极简组合**：每个 skill 单一职责，可任意拼装；纯 markdown 跨模型可用
- **细节考究**：例如 diagnose 要求"tag every debug log with `[DEBUG-a4f2]` 便于清理"、triage 要求 AI 评论带 disclaimer、interface 不仅指类型还包括 invariants / ordering / error modes

### 劣势

- **缺工程化封装**：没有脚本辅助、JSON 输出、Phase 编排，完全依赖 AI 自觉
- **缺项目记忆系统**：只有 CONTEXT.md / ADR / .out-of-scope 三类轻量文档，没有 soso-kit 的多模块多项目层级
- **流程颗粒度粗**：tdd 无 plan/task/check 三段式，所有阶段由 AI 自驱
- **无 token 预算可视化**：除 caveman 之外，没有 token 计量机制
- **无多项目隔离**：所有 skill 全局，不按项目分（soso-kit 有 modules/projects 维度）
- **依赖 Claude Code Skills 协议**：与 slash commands 系统不互通

---

## 与 soso-kit 对比

| 维度 | mattpocock/skills | soso-kit | 启发 |
|------|-------------------|----------|------|
| 系统协议 | Claude Code **Skills**（auto-trigger by description） | Slash **Commands**（用户显式 / 触发） | 路线不同，不照搬 |
| 注入策略 | **Soft / Hard 分级** + Lazy | **Always-on 全量注入** | ⭐⭐⭐ 核心借鉴 |
| 编排 | Skill 自洽，无 Phase 框架 | shell 脚本 + workflow .md Phase 编排 | 各有优劣 |
| 切片单位 | Vertical slice 贯穿 | Phase 顺序（clarify→spec→plan→task→check）| 审视 task 是否 horizontal |
| 共享语言 | CONTEXT.md domain glossary（术语粒度） | Context Library（功能粒度） | ⭐⭐ 加 glossary 层 |
| 项目记忆 | CONTEXT + ADR + .out-of-scope（三层）| Context Library + Modules + Projects（多维）| soso-kit 更深 |
| 评审 | Two-axis 并行 sub-agent | 单深度 /k:review | ⭐⭐ 双轴化 |
| Token 经济学 | 软硬依赖 + Lazy + caveman | always-on + Phase token 计量 | ⭐⭐⭐ 学软硬依赖 |
| 命令规模 | 14 个 skill | 35+ 命令 + 136 context docs + 40 migration docs | ⭐⭐⭐ deletion-test 自审 |
| 哲学 | 极简、灵活、低 token | 工程化、深度、高保障但 high token | 不同 trade-off |

---

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**大**。不是表面照搬补丁，而是**借三个机制反思 soso-kit 自身的 token 经济学**：

- **Soft / Hard 分级**：直接解决 always-on 注入膨胀（当前每次对话开头几千 token 是 starrocks-rules / clean-code / auth.md 全量塞入，但对话不一定碰这些领域）
- **Deletion test**：解决命令爆炸（35+ 命令）、Context Library 文档冗余（136 docs）
- **Two-axis review**：让 /k:review 真正能并行覆盖规范 + 需求两面

### 2. 有必要吗？

**必要**。soso-kit 已到"再加东西就崩"的临界点 — 命令多、规则多、注入重。继续加补丁会加速恶化。这是个**减法机会**而非加法。

### 3. 更新后能提升哪些？

#### ⭐⭐⭐ 机制级（强烈建议）

- ✅ **把 always-on 规则改造成 model-invoked skill**：
  - 当前：`.claude/rules/modules/sodex-web/precision-calculation.md` 等全量 always-on 注入
  - 改造：迁移到 `~/.claude/skills/precision-calculation/SKILL.md`，frontmatter description 写 "Use when working with calculate() / parseFloat / toFixed / MobX numeric fields / 数值比较 / 精度"
  - 配套：description "Use when" 子句必须精心编写（关键词 + 场景齐全），否则 AI 不会自动触发
  - 注意：soso-kit 现有的 `soso-responsive-modal-creation` / `fix-i18n` / `check-i18n` / `soso-translation-*` 已是 model-invoked 模式，证明路径可行；只是 `.claude/rules/modules/*/` 下规则没迁移

- ✅ **保留 hard dependency 的 always-on**：
  - `constitution.md`：每对话都该生效 → 保留
  - `starrocks-rules.md` / `auth.md`：错了出错代码 → 暂保留 always-on（属 hard dep）
  - `git-commit.md` / `figma-style-mapping.md` / `event-driven.md`：缺了仅输出稍弱 → 改 soft（model-invoked）

- ✅ **Deletion test 反审 soso-kit 自身**：
  - 35+ 命令哪些是 pass-through？mastery / auto-on / auto-off / version 删了痛吗？
  - 136 Context docs 哪些是僵尸文档？/k:context-audit 已有零 token 检测可配合
  - 40 migration docs 是否过期？

- ✅ **Lazy creation 扩展到规则文件**：当前 context-init 创建完整骨架，改为按需创建

#### ⭐⭐ 设计级（推荐做）

- ✅ **Two-axis /k:review 拆分**：Standards sub-agent + Spec sub-agent 并行，不互相掩盖
- ✅ **Context Library 加 `glossary/` 层**：每个 module 可选 terms.md，独立于功能文档
- ✅ **反 horizontal slicing 审计 /k:task**：检查 task 是否产生"先列所有任务再批量实现"反模式
- ~ **Agent Brief 耐用性原则注入 /k:spec**：强化"behavior over file path"
- ~ **HITL / AFK 标注**：/k:plan / /k:task 每步标自主性

#### ⭐ 元思想（长期影响）

- ✅ **Interface = Test Surface = AI Navigation Surface**：长期指导 soso-kit 命令接口设计（少而深 vs 多而浅）

#### ⚠️ 不提升

- ⚠️ spec / plan / task / check 工作流已经够好，不需要照搬 grill / tdd / triage / to-prd / to-issues
- ⚠️ debug-on / capture / analyze-live 比 mattpocock diagnose 更深
- ⚠️ /k:caveman / /k:handoff 是表面补丁，已撤回

### 4. 结论

**做减法 + 做机制升级，不做补丁**。

具体落地：

1. **审计 always-on 注入**：把 `.claude/rules/modules/*/` 下规则按 soft/hard 分级
2. **soft dep 迁移到 Skills 系统**：在 `~/.claude/skills/` 或 `.claude/skills/` 新建 SKILL.md，description "Use when" 子句精心编写
3. **deletion-test soso-kit 自身**：跑一轮 — 哪些命令删了不影响主流程
4. **/k:review 双轴化**：拆 Standards / Spec 两个并行 sub-agent
5. **Context Library 加 `glossary/` 层**：每个 module 可选 terms.md
6. **不新增** /k:caveman / /k:handoff / /k:grill 等补丁命令

**先前误判修正**：

- ❌ /k:caveman 撤回 — constitution "信息精简" 已覆盖
- ❌ /k:handoff 撤回 — harness auto-compaction 已覆盖
- ❌ 表面补丁式 glossary 撤回 — 改为 Context Library 多一层 glossary 结构调整

**一句话**：mattpocock/skills 的真正价值不是"抄几个 skill"，是**「token 经济学 + 软硬依赖分级 + deletion test 反审 + Skills 协议自动触发」四件机制**。soso-kit 应该用它们审视自己，做减法和分层，把软依赖迁移到 Skills 系统按需加载。

### 额外 token 消耗评估

| 项 | 一次性 | 长期 |
|---|---|---|
| 审计 always-on 注入并分级 | 4-8 小时人工 | **节省** 60-70% 注入 token / 对话（迁移到 model-invoked 后）|
| 迁移 soft dep 到 Skills | 每规则 30 分钟（含 description 编写）| 同上 |
| deletion-test 自审 | 2-4 小时 | 命令/文档减负，长期节省 |
| /k:review 双轴改造 | 1-2 小时 | 单次评审 +1 sub-agent 调用（~+30% review token），但发现率提升 |
| glossary 层添加 | 按模块逐步 | spec/clarify 时减少 AI 同义词飘移，节省 token |

**净效益**：long-term token 净节省 + 命令体验提升。

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~2,100 tokens |
| 分析阶段（含三轮深度修正 + 实现原理深挖）| ~22,000 tokens |
| 文档阶段 | ~4,500 tokens |
| **总计** | **~28,600 tokens** |

> 注：本研究经历了四轮分析迭代 — 浅扫描 → 自我修正 → 深读机制层 → 实现原理深挖（Skills 协议 + Progressive Disclosure）。token 消耗高于平均 study 任务，但产出价值也更高（找到迁移路径）。

---

## 第二轮深读复盘（2026-05-22）

> 拉取最新 main（b8be62f → 694fa30），重点深读 grill-me + 密度对比 + 实际 ROI 评估后的新结论。

### 拉取期间项目变化

```
b8be62f → 694fa30（17 个 commit）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✨ 新增  productivity/teach/  (131 行 + 4 个 FORMAT 文件)
  📝 微调  grill-with-docs/CONTEXT-FORMAT.md  (5 行)
  📝 微调  to-prd/SKILL.md  (6 行)
  ─────────────────────────────
  grill-me 主体未变（仍然 11 行 / 6 句行为指令）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### grill-me 深度复盘（11 行核心机制）

```
Interview me relentlessly about every aspect of this plan until we reach
a shared understanding. Walk down each branch of the design tree,
resolving dependencies between decisions one-by-one. For each question,
provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the
codebase instead.
```

每句一条机制：

| 句 | 机制 |
|---|---|
| "Interview me relentlessly" | 取消"问够了就停"默认，由用户决定停 |
| "every aspect" | 不预设维度，按模糊度自决 |
| "Walk down each branch" | DFS — 一支问透再换下一支 |
| "Resolving dependencies one-by-one" | 隐式拓扑序 — 先问独立决策再问受影响的 |
| "Provide your recommended answer" | 强制 AI 不当哑壶 — 每问必带答案 + 理由 |
| "Ask one at a time" | 反对一次抛多问 |
| "Explore instead [of asking]" | 反"无意义提问" — 能查代码不要问 |

**设计哲学**：把流程交给 AI（无规定问几个 / 哪些维度 / 输出格式），把约束交给规则（行为风格 + 反模式 + AI 责任）。

### grill-me vs /k:clarify 全维度对比

| 维度 | grill-me（11 行） | /k:clarify（321 行） |
|---|---|---|
| 提问数 | 无限制 | 上限 8 |
| 提问维度 | AI 自决 | 8 固定维度分必问/核心/可选 |
| 提问深度 | DFS | BFS |
| 推荐答案 | 自由格式 | 强制 `推荐 →/理由 →` 双行 |
| 进度显示 | 无 | "📍 问题 N/总数" |
| Explore-first | 有 | 有（Step 1 前置）|
| HARD-GATE | 无 | 有 |
| 产出 | 无（纯对话）| Spec 文档 |
| 后续衔接 | 无 | spec-create.sh + /k:spec |
| Context 联动 | 无 | preflight.sh |

### 心智模型差异（解释行数差 3 倍的根因）

```
mattpocock 心智模型：
  Skill = 行为指令包
  AI = 决策者
  "我告诉 AI 怎么想，它自己决定怎么做"

sosokit 心智模型：
  命令 = 工作流模板
  AI = 模板执行者
  "我把流程编排好，AI 按步骤执行"
```

两种都正确，trade-off 不同：

| | mattpocock 拆分 | sosokit 集成 |
|---|---|---|
| 优势 | 单一职责 / 组合灵活 / 低 token | 流水线完整 / 产出可衔接 / 工程保障 |
| 劣势 | 用户自行编排 | 单命令膨胀 / 修改成本高 |
| 适合 | 个人 / 灵活探索 | 团队 / 标准流程 |

### 新发现：/teach（多会话状态化范式）

mattpocock 第一个**跨会话状态化** skill：

```
<workspace>/
├── MISSION.md           ← 学习动机（一切教学的依据）
├── RESOURCES.md         ← 高质量资源
├── NOTES.md             ← 用户偏好
├── ./reference/*.html   ← 速查文档
├── ./lessons/*.html     ← 单元课程（Tufte 风格）
└── ./learning-records/  ← 类 ADR 学习记录
    └── 0001-xxx.md
```

**教学哲学**：Knowledge / Skills / Wisdom 三分；Fluency vs Storage strength；Zone of Proximal Development；Wisdom 必须交给社区。

**对 sosokit 的启发**：
- `learning-records` 模式可借鉴 — Context Library 当前是「功能记忆 + pitfall」，可补一类"非显然教训"，区别于 bug
- 多会话状态化 workspace 模式 — sosokit spec 工作流是单会话产物，缺「长期重构项目跟踪」概念

---

## /k:clarify 密度审视 Dry-Run（已评估，决定不做）

### 审视结论

| 段落 | 行号 | 性质 | 可压缩 |
|---|---|---|---|
| HARD-GATE / Step 0 / 探索 / 必问表 / 7 章节表 / 6 项核查表 | 散落 | 真锚点 / 真模板 | ❌ 不动 |
| Step 1.5 提问前心态 | 66-75 | 装饰 | -8 行 |
| Step 2 输出格式两版 | 80-104 | 像素级格式 | -17 行 |
| Step 2 提问规则 | 105-145 | 部分冗余 | -6 行 |
| Step 5 验收场景两示例 | 199-225 | 部分冗余 | -16 行 ⚠️ |
| Step 6 PASS/FAIL 双表 | 257-292 | 装饰 | -17 行 |
| 完成卡片格式细则 | 294-321 | 装饰 + 隐含规则 | -13 行 |

**理论压缩量**：321 → 244 行（-24%）

### 投入产出分析

| 项 | 估算 |
|---|---|
| 整套 38 命令密度审视投入 | ~65 小时（每命令 ~1.5h + 跨命令一致性 + 备份管理）|
| Token 节省 | ~400 tok/次 × 5-10 次/天 = **2-4k tok/天** |
| 维护性收益 | 每次改命令节省 ~5 min（找重复段落），分散 |
| ROI | 🔴 **低**（投入大、收益分散、需长期观察）|

### 与其他可选行动对比

| 行动 | 投入 | 收益 | ROI | 优先级 |
|---|---|---|---|---|
| 密度审视 38 命令 | ~65h | 全局 -20% 行数 + 2-4k tok/天 | 🔴 低 | **P3 不优先** |
| deletion test 反审 | 5-10h | 删 5-10 个 pass-through 命令 | 🟢 高 | **P1 优先** |
| always-on → model-invoked skill | 10-15h | 每对话开头省 ~10k tok | 🟢🟢 极高 | **P1 优先** |
| essential 抽取（已完成）| 8h | DRY 消除 + 单点维护 | ✅ | 已做 |

### 决策

**密度审视降为 P3 — 不作为下一动作**。理由：
- 密度审视性质：「文档优化」，改善但不消除问题
- deletion test 性质：「结构精简」，减命令数比减行数更解负
- model-invoked 性质：「机制升级」，省常驻 token 不是单次 token

**单命令痛点驱动**：若某个具体命令使用中明显笨重（如改一处规则要看 5 段），单独做该命令的密度审视。不要整体推进。

### Gate 自审揭示的隐含风险（即便单做也要注意）

| 风险点 | 说明 |
|---|---|
| Card A 卡片细则不全是装饰 | "·" bullet / "长路径允许超出" / "缩进 5 格" 是真视觉契约，删了 AI 输出会漂移 |
| Step 2 "不用 ┃ 双栏" 是命令族契约 | 区分 clarify（单栏）vs spec 反问（双栏），删了视觉系统一致性破坏 |
| PASS/FAIL 双表合一的模式差异 | "说明列变 file:line + 一句话修复点"用文字描述不如双表对比直观 |
| 风险标"🟢 低"全是 [推理] | 未实测验证，需备份 legacy + 1-2 周 A/B 才能确认 |

---

## 修正后的优先级（替代第一次 study 的"借鉴建议"）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✅ 已完成
  Essential 层抽取（rules-essential v1.0.0）
  install/sync 双向支持 essential（cli v1.17.0）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🟢 P1 高 ROI
  ⭐⭐⭐ Deletion test 反审 38 命令
    auto-on / auto-off / codex-on / codex-off / mastery / version 等是否 pass-through？
    投入 5-10h，可能减 5-10 命令，效果立竿见影

  ⭐⭐⭐ always-on rules → model-invoked skills
    把 rules/modules/*/  下软依赖规则迁到 .claude/skills/
    投入 10-15h，每对话开头省 ~10k tok
    description 的 "Use when" 子句写好是关键

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🟡 P2 中 ROI
  ⭐⭐ Two-axis /k:review（Standards + Spec 并行 sub-agent）
  ⭐⭐ Context Library 加 learning-records 类型（借鉴 teach）
  ⭐ /k:new-command 元命令（借鉴 write-a-skill）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🔴 P3 低 ROI（不优先）
  ✗ 整套 38 命令密度审视（投入 ~65h，收益分散）
  ✗ 单命令密度审视（仅在具体命令痛了再单做）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ 撤回（已废弃的早期建议）
  /k:caveman / /k:handoff / /k:grill（补丁式，路线不对）
  照搬 grill-me 11 行风格（丢工程保障）
  整体改用 model-invoked 替代 commands（路线不同）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 变更记录

- 2026-05-21: 首次分析
- 2026-05-21: 修正 — 用户用第一性原理质询后，撤回补丁式建议（caveman/handoff/表面 glossary）
- 2026-05-21: 深读 — 深读 LANGUAGE.md / DEEPENING.md / ADR-0001 / setup-skill / review-skill / triage 后，提炼 9 个机制级元思想，重定位为「token 经济学 + 反审自身」
- 2026-05-21: 补充实现原理章节（Claude Code Skills 协议 + Progressive Disclosure），明确 always-on 迁移到 model-invoked 的具体路径；文档改名 `skills.md` → `mattpocock-skills.md`
- 2026-05-22: 第二轮深读 — 拉取最新 main（694fa30），重点深读 grill-me（11 行机制）+ 新增 teach skill 范式 + /k:clarify 密度审视 dry-run；经 /k:cp gate 自审与 ROI 分析后，**决定密度审视降为 P3 不优先**；重新整理优先级表，P1 为 deletion test + model-invoked 改造
