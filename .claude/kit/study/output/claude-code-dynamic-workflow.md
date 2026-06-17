# Study: Claude Code Dynamic Workflow

| 项 | 值 |
|----|-----|
| 来源 | https://x.com/riba2534/status/2060102236676792711?s=46（Anthropic 官方功能 research preview，随 Opus 4.8 同期发布） |
| 分析日期 | 2026-05-30 |
| 发布日期 | 2026-05-28 |
| 类型 | Claude Code 编排原语（非 GitHub 仓库，本研究基于官方文档 + 实测案例） |
| 体量 | 1 个内置 Workflow（`/deep-research`）+ JS 编排运行时 + `agent()/parallel()/pipeline()` 原语 |
| 版本要求 | Claude Code v2.1.154+ |

---

## 核心思想与原则

1. **把计划搬进代码**：传统 subagent 模式下 Claude 是编排者——逐轮决定派谁、每个结果都回到 Claude 上下文。Workflow 把循环、分支、中间结果固化进一段 JavaScript 脚本，**Claude 的上下文里只剩最终答案**。
2. **运行时无脑、节点处雇 LLM**：一个确定性 JS 运行时当指挥（只会循环、拼字符串、await，本身不含 LLM），只有执行到 `agent()` 那行才临时雇一个 subagent 调模型。**主 Claude 在脚本执行期间在睡觉**，跑完用通知叫醒它读结果。
3. **不请求服务端**：Workflow 本身是本机跑的编排脚本，真正调模型的是 `agent()` spawn 出的 subagent，走的是 Claude Code 平时那套 Messages API。
4. **编排即可复用资产**：subagent 复用"一个工作者"、skill 复用"一条指令"，而 Workflow 复用**整套编排逻辑**——写一次可存进 `.claude/workflows/` 反复跑。

## 运行原理（一句话）

> JavaScript 运行时当指挥（无脑、确定性），在 `agent()` 点临时雇 LLM 干活，主 Agent 全程睡觉，只在最后被叫醒读结果。

**核心原语**：

| 原语 | 作用 | 关键特性 |
|------|------|----------|
| `agent(prompt, opts)` | spawn 一个 subagent | 带 `schema` 时强制结构化 JSON 输出，不匹配自动重试 |
| `parallel(thunks)` | 并发跑一批，**有 barrier**（等全部完成） | 仅在需要全集结果时用（去重/合并/提前退出） |
| `pipeline(items, ...stages)` | 每个 item 独立流过所有 stage，**无 barrier** | 默认选择；wall-clock = 最慢单链而非逐阶段求和 |
| `phase()` / `log()` | 进度分组 / 进度消息 | — |

**执行轨迹永远是 DAG**：程序层面带 `while` 不是 DAG（有环），但任何一次执行展开后一定是 DAG——这正是它比传统 DAG 编排器（Airflow/Argo）更强的地方：拓扑是命令式脚本跑出来的，运行时才定形。

## Workflow vs Agent Teams vs Subagent（三拓扑对照）

| 原语 | 拓扑 | 节点是什么 | 节点间通信 | 主会话状态 | 复用的是 |
|------|------|-----------|-----------|-----------|---------|
| **Subagent** | 主会话逐个派 | 临时工 | 无，各自回报主会话 | 全程在线，逐轮决策 | 一个工作者 |
| **Agent Teams** | 网状协作 | **独立 Claude Code 会话**（有持久身份） | **互相通信** | 是团队一员 | 一支团队 |
| **Workflow** | 树状 fan-out/fan-in | **无状态临时 subagent**，跑完即弃 | **互不通信** | **发出调用后睡觉**，脚本后台跑 | 整套编排逻辑 |

> ⚠️ **关键澄清**："一个会话管理其他会话"是 **Agent Teams**，不是 Workflow。Workflow 是"一段脚本调度一批不通信、跑完就丢的临时工"，主会话压根不在场。未来若需"多个有记忆的角色长期协作"，选 Agent Teams；需"散开干无状态的活、收回结果"，才选 Workflow。

## 适合工作的环境（甜区）

✅ **适合**（共同点：规模超出一轮对话能协调 / 需要 fan-out 或循环到收敛）：
- 代码库范围批量排查（全仓 bug 扫描、安全审计、反模式加固——搜索 + 独立验证）
- 大规模迁移与现代化（框架替换、API 弃用、跨语言移植；Bun 用它 11 天迁移 75 万行 Zig→Rust）
- 需要反复推敲的关键决策（多角度独立做一遍 + 对抗式 agent 试图推翻，迭代到收敛）
- 长尾清理（overnight workflow 挂着自动扫问题、逐个开 PR）

❌ **不适合**：
- 一两步就能搞定的小修补（杀鸡用牛刀）
- 需要中途频繁人工拍板的探索性工作（**Workflow 跑起来不接受人工输入**，除权限弹窗）
- 碰安全 / 支付等高风险代码的改动

**硬约束**：最多 16 并发 subagent / 单次 1000 agent 上限；脚本本身无文件和 shell 访问（全靠 subagent）；跨会话不可恢复（退出 Claude Code 就从头跑）；token 消耗明显高于普通对话。

---

## 对 soso-kit 的帮助（现状评估）

### 关键发现：soso-kit 已在做散文版编排

soso-kit 的核心信条——"脚本处理机械操作、AI 处理智能分析""机械门禁优于 AI 自觉""反 AI 记忆作 ground truth"——和 Workflow"确定性运行时 + 节点雇 LLM"是**同一思想的不同实现**。Workflow 本质是把 soso-kit 一直手搓的 `claude -p + 编排` harness 产品化了。

但 soso-kit 现在用的是"散文描述 + 主 Claude 逐轮调度"模式，三处铁证：

| 命令 | 现状编排方式 | 证据 |
|------|------------|------|
| `/k:analyze` 复杂模式 | 主 Claude 手动派 B/C/F 并行 → D/E/G 串行 → cross-check → 核验 agent | `analyze.md` Step 3-B：散文 barrier + "主 agent 必须 cross-check" |
| `/k:analyze-live` | 静态多 agent + 运行时采集，散文驱动 | `analyze-live.md` |
| `/k:migration` | 薄路由（109 行），靠 `🔄 继续进入?(Y/N)` 人工签核串联 | `migration.md` |

### 三层增量分析

| 层 | Workflow 是否解决 soso-kit 的问题 | 说明 |
|----|-------------------------------|------|
| **原理层** | ❌ 无新增 | soso-kit 本就是这个原理，Workflow 是印证不是突破 |
| **运行逻辑层** | ⚠️ 有一处窄修复 | `analyze` 的散文 barrier（3-B.3）依赖主 Claude 自觉——正是 soso-kit 反对的"凭 session 记忆"。Workflow 用 `parallel()` 把它变成代码强制。但 `analyze` 只 fan-out 7 个 agent，问题低频 |
| **数据结构层** | ✅ 清晰净增量 | "每行必填 `file:line`"现在是 prompt 软约束 + 事后抽样核验；Workflow 的 `schema` 把它变成生成时硬门禁，正中"机械评分替代 AI 自判" |

> **注意**：soso-kit 的 `analyze` 已把中间结果写成文件（`<topic>-task-{B|C|F}.md`），"中间结果不进主上下文"已实现了一半，Workflow 增量比表面看小。

## 是否过度设计？

**对今天的 soso-kit，广泛采用 = 过度设计**。三个理由：

1. **主干是线性人工闸门流**：clarify→spec→plan→task→check 是单 agent 顺序 + 中途要拍板，Workflow 中途不能问人，塞不进一个脚本。
2. **没有命中甜区的任务**：soso-kit 最大 fan-out 是 7 个 agent，够不到"数十路并发 / loop 到收敛"的甜区。
3. **与立身之本冲突**：soso-kit 核心竞争力是"信号密度优先 / 省 token"（commit 用 `-U0` 替 `-U3`），Workflow 是反方向用 token 换规模。在不需要处上 Workflow 违反其 constitution 的"信息精简 / 路径最短"。

> 唯一不算过度的，是 `analyze` 复杂模式那一个点；而即便那一点也有更短路径（见下）。

## 将来的帮助（未来 soso-kit 演化方向）

筛选标准：必须是数十路 fan-out 或 while 循环到收敛。按此标准有 4 个真甜区：

| 未来场景 | 为什么命中甜区 | 价值 |
|---------|--------------|------|
| **Context Library 全量审计/重建** ⭐ | 138 篇文档每模块派 agent → diff 源码 → schema 化漂移点 → loop 到全绿；**同时命中数十路 fan-out + 结构化校验 + loop-until-dry** | 治 soso-kit 老毛病（文档漂移），收益最大 |
| **大规模 migration** | `/k:migration` 触及上百文件时，每文件 transform + 双 reviewer 正是 Bun 模式 | 人工闸门保留为 Workflow 之间的边界 |
| **Overnight 批处理** | 后台跑、主会话不阻塞、跑完通知 | 解锁"异步 soso-kit"新形态（命令从同步对话变异步任务） |
| **VERDICT 升级评审团** | complex 档 / 红线改动派多 reviewer 不同 lens 投票 | 仅高风险值得（token 翻倍） |

**最深契合点**：soso-kit 可演化成"Workflow 工厂"——`.md` 命令根据当次任务**生成** tailored 脚本，通用的存进 `.claude/workflows/` 变成团队共享 `/<name>` 命令，VERDICT/HARD-GATE 从 prompt 软约束进化成 schema + 代码硬约束。

## 与 soso-kit 对比

| 维度 | Dynamic Workflow | soso-kit | 启发 |
|------|------------------|----------|------|
| 编排载体 | 模型现写的图灵完备 JS | 散文 `.md` + shell 脚本 | Workflow 表达力更强（可写循环/动态扇出） |
| 编排作者 | 模型（运行时生成） | 人（预先编写命令） | 各有优势 |
| 确定性门禁 | `schema` 结构化强制 | VERDICT 机械评分 + HARD-GATE 原子块 | 思想同源，Workflow 的 schema 可补强 |
| 中间结果 | 留在脚本变量 | 写成 task 文件 | soso-kit 文件方式可审计、可跨会话 |
| 并发规模 | 数十~数百 agent | ≤ 7 agent | Workflow 完胜（但 soso-kit 暂无此需求） |
| 人工闸门 | 不支持中途输入 | clarify/migration 大量人工签核 | soso-kit 完胜（适配交互式开发） |
| Token 哲学 | 用 token 换规模 | 信号密度优先、省 token | 方向相反，按需取舍 |
| 跨会话恢复 | 同会话内可 resume | 命令可独立跳入/重入 | 各有方案 |

---

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**当下小，未来中到大**。当下 soso-kit 没有命中甜区的任务，唯一受益点（`analyze` 复杂模式）有更短的非 Workflow 替代。未来当出现全仓级 fan-out 命令时，价值显现。

### 2. 有必要吗（最短路径检验）？

承接 constitution "路径最短"——`analyze` 的三条独有增量，有没有不引入 JS 运行时的更短解？

| 想要的增量 | 更短路径 | 是否非 Workflow 不可 |
|-----------|---------|---------------------|
| `file:line` 硬门禁 | Step 5 核验 agent 从抽样改全量结构校验 | ❌ 现有机制可达八成 |
| barrier 不跳步 | 3-B.3 散文改成显式 HARD-GATE 原子块（soso-kit 已有此模式） | ❌ 可达 |
| loop-until 收敛 | — | ✅ 非 Workflow 不可 |
| scale 到数十 agent | — | ✅ 非 Workflow 不可 |

**结论**：soso-kit 今天**不该**为 `analyze` 引入 Workflow——用已有 HARD-GATE + 全量核验，以更短路径拿到大部分增量。

### 3. 更新后能提升哪些？

- ⏸ **触发条件**：新增一个本质上需要数十路 fan-out 或 while 循环到收敛的命令（如"全仓扫某反模式直到无新增""Context Library 全量审计"），才是该上 Workflow 的决定性信号。
- ⭐ **首选未来试点**：`Context Library 全量审计` Workflow——`pipeline(模块列表, diff源码stage, 校验stage)`，schema 强制漂移点结构化，loop 到全绿。既命中甜区，又治文档漂移老毛病。
- ⚠️ **不提升**：线性人工闸门主干（clarify/spec/plan/task/check）永远不该 Workflow 化。

### 4. Token 会不会过多消耗？

量级锚点（实测）：**每个 subagent 平摊约 50k–75k token**（135 会话案例 11 agent/818k；调研 15 agent/270k），因每个 agent 重载系统 prompt + tool 定义（prompt caching 摊大头）。

| 改法 | token 影响 |
|------|-----------|
| 1:1 平移现有 7 agent | 大致持平，主上下文反而**省**（不再跨回合堆 7 份 doc） |
| 顺手加"质量套餐"（多票对抗验证 / loop-until-dry） | **成倍增长** |

> **真正的 token 风险不在 Workflow 本身，在"既然上了就顺手加交叉验证"的冲动。** 改的话必须克制：只搬编排，不加冗余验证层——否则直接违背 soso-kit 省 token 的立身之本。

### 5. 结论

**暂不落地，标记触发条件**。Dynamic Workflow 与 soso-kit 思想同源，但当下 soso-kit 的任务规模够不到甜区，且主干是人工闸门线性流。真正该上 Workflow 的时机是**新增全仓级 fan-out / loop 类命令**时——首推 `Context Library 全量审计`。在那之前对 soso-kit 是过度设计。

**一句话**：Workflow 不是"会话管会话"（那是 Agent Teams），而是"把多 agent 命令从散文编排升级成代码编排、解锁全仓级 fan-out 和异步 overnight 批处理"——soso-kit 该等到出现真甜区任务再投入，不为现有 7-agent 小编排买单。

### 额外 token 消耗评估

| 落地项 | 常驻 token | 调用 token | 优先级 | 状态 |
|---|---|---|---|---|
| `Context Library 全量审计` Workflow | 0 | 数十 agent × ~50-75k（仅触发时） | P2 中（待出现真需求） | ⏸ 标记触发条件 |
| `analyze` 复杂模式 Workflow 化 | 0 | 持平现状 | ✗ 跳过（更短路径可替代） | ❌ 不做 |
| 主干命令 Workflow 化 | — | — | ✗ 永不 | ❌ 不做 |

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 调研阶段（多轮讨论，读 profile + analyze/migration 源码） | ~8k tokens |
| 文档阶段（整理三轮结论 + 对齐格式） | ~4k tokens |
| **总计** | **~12k tokens** |

## 变更记录

- 2026-05-30: 首次研究。整合三轮讨论：原理/三拓扑对照/适用环境/对 soso-kit 现状与未来评估/过度设计判断/token 评估。结论"暂不落地，标记 Context Library 全量审计为未来触发条件"。
