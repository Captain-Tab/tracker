# Study: codegraph

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/colbymchenry/codegraph |
| 分析日期 | 2026-05-28 |
| Commit | 02935d7 (main) |
| 语言 | TypeScript（174 个 .ts 文件） |
| 形态 | npm 包 `@colbymchenry/codegraph` + CLI + MCP Server |
| 许可 | MIT |

---

## 📊 借鉴裁决（先看结论）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✗ detect 脚本 + 命令分支              → 过度设计，0 用户场景受益
  ✗ 注入 codegraph 工具指南到 Explore   → prompt 膨胀，净亏 token
  ~ 在 study/output/codegraph.md 留索引 → 当作"外部工具档案"，纯档案不动产
  ✓ 不做任何代码改动                    → 这是最短路径
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总体：codegraph 优秀但与 soso-kit 服务的真实项目规模错位。
        档案归档即可，不集成、不修命令、不写 detect。
```

---

## 核心思想与原则

**预计算 AST 知识图 → 通过 MCP 提供给 Agent，把"探索代码"从工具循环变为单次查询。**

- **结构 vs 文本**：grep/Read 适合字面文本，AST 图适合结构问题（谁调用谁、签名、影响面）
- **本地优先**：tree-sitter wasm + SQLite，零网络、零云依赖
- **agent 友好的工具集**：10 个 `codegraph_*` MCP 工具，每个 description 里写"什么时候用我"，`codegraph_context` 描述直接写 "PRIMARY TOOL — call this FIRST"，引导 Agent 选最经济路径
- **always-apply 规则注入**：`.cursor/rules/codegraph.mdc` 把"何时优先用 codegraph"的决策表常驻 Agent 上下文
- **多 Agent 覆盖**：installer 一键配置 Claude Code / Cursor / Codex / opencode / Gemini / Kiro / Antigravity 等 8 个 Agent

## 核心流程

```
codegraph init -i
    ↓
扫描源码（tree-sitter 19 种语言：TS/JS/Py/Rust/Go/Java/Kotlin/Swift/...）
    ↓
抽取 Node（function/class/method/...） + Edge（calls/imports/extends/...）
    ↓
写入 .codegraph/graph.db (SQLite)，chokidar 监听文件增量更新
    ↓
MCP daemon 提供查询：search / context / callers / callees / trace / impact / explore / node / files / status
    ↓
Agent 通过 MCP 协议查询，单次返回结构化结果（无需 grep 循环）
```

关键模块：
- `src/extraction/` — tree-sitter 抽取，每语言一份适配器
- `src/db/schema.sql` — nodes/edges/files/unresolved_refs 表
- `src/graph/` — 图遍历查询
- `src/mcp/tools.ts` — 2711 行的工具定义，每个工具的 description 写给 Agent 看
- `src/installer/` — 多 Agent 一键配置
- `src/sync/` — 文件监听 + 增量更新

实测基准（v0.9.4，2026-05-24）：**平均 35% 便宜 / 57% 少 tokens / 46% 提速 / 71% 少工具调用**（7 个开源项目）。

## 优势与劣势

### 优势
- **基准实测有效**：35% 便宜 / 70% 少工具调用 / 46% 提速
- **覆盖广**：19 语言、8 Agent，单一二进制可装到任何 Agent 工具链
- **零配置**：bundled Node，无需 install 依赖；installer 自动改 Agent 配置
- **工具描述即 prompt**：MCP 工具描述把使用策略明文写在 schema 里
- **基础设施级定位**：与 Agent 框架本身解耦

### 劣势
- **只覆盖"读"**：纯查询能力，没有"写代码该遵守什么规范""这个 feature 的业务逻辑是什么"等知识
- **冷启动开销**：初次扫描 10k 文件级仓库需数十秒至分钟
- **结构 ≠ 意图**：知道 X 调用 Y，但不知道为什么这样写、踩过什么坑——这是 Context Library 解决的层
- **语言适配工作量**：每个新语言都要写 extractor
- **不解决工作流问题**：clarify / spec / plan / task / check / commit 等编排不在能力范围

## 与 soso-kit 对比

| 维度 | codegraph | soso-kit | 启发 |
|------|-----------|----------|------|
| 定位 | 代码结构查询基础设施（MCP server） | AI 工作流编排 + 业务知识沉淀 | 两者正交，**互补不互斥** |
| 形态 | 单一 npm/二进制包，跨 Agent | `.claude/commands/*.md` + bash 脚本 | codegraph 跨 Agent 形态值得学习，但 soso-kit 当前足够 |
| 知识来源 | 自动 AST 抽取 | 半自动（`/k:context-learn` + 手写 spec） | 大库下可考虑套用，但用户项目均未装 |
| Agent 接口 | MCP 工具（自带 description 引导） | slash command + always-on 规则注入 | "工具 description 即 prompt"思路可借鉴 |
| 知识维度 | 结构（who calls who） | 业务（为什么这样写、状态机模型、坑） | 互补 |
| 索引/失效 | chokidar 自动增量 | 手动 `/k:context-update` + 零 token `/k:context-audit` | 各自方案合理 |
| 写代码场景 | 无 | clarify→spec→plan→task→check 全链路 | codegraph 不进入 |

---

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**小。** 关键三点：

- **核心错位**：soso-kit 核心价值是 `/k:spec` `/k:plan` `/k:task` `/k:check` `/k:commit` 工作流编排 + Context Library 业务知识。codegraph 完全不触及。
- **可受益命令少**：仅 `/k:analyze` `/k:context-learn` `/k:migration analyze` 三个"逆向理解既有代码"命令理论受益。其余 80%+ 命令无关。
- **用户项目规模错位**：codegraph 的红利曲线对千文件级才开始陡峭（基准里 Gin 110 文件仅 21% 便宜，VS Code 10k 文件 78% 少 tokens）。soso-kit 实际服务 sodex-web/next/lens 都是 ≤1500 文件前端仓库，grep 本来就秒级。

### 2. 有必要吗？

**不必要。**

- 现状 grep+Read 在 sodex-web/next 这种千文件级前端项目里**不是瓶颈**。
- 即便集成，用户项目侧也必须先 `codegraph init` —— 当前 0 项目装了。集成意味着 99% 走 fallback = 死代码。
- 若未来真遇到万级文件 monorepo 分析，**直接让用户装 codegraph 并调用其 MCP 工具**比 soso-kit 包装一层更短路径。

### 3. 更新后能提升哪些？

逐条检验前一版给出的"3 个落地建议"是不是核心逻辑优化、是否过度、是否净亏 token：

| 建议 | 是核心逻辑优化吗？ | 过度设计风险 | Token 净收益 |
|------|------------------|------------|--------------|
| **加 detect-codegraph.sh + 3 命令分支** | ✗ 非核心。`/k:analyze` 的核心是「多 agent 并行探索 + 核验 agent 反向验证 + 行为流完整性」，codegraph 只优化"读"那一截 | **过度**。外部硬依赖 + 双路径（available/fallback）+ 教 Explore agent 用 codegraph_* 工具 = 三处维护点 | **可能净亏**。要教模型用工具就得注入 codegraph 使用指南（~800 tokens prompt），中小项目 grep 本来就快，节省不抵注入 |
| **在 projects 模板加"推荐安装"段落** | ✗ 不是逻辑变更，只是文档提示 | 低 | 中性（一次性静态文件） |
| **检测分支注入 3 个命令** | ✗ 同第 1 项 | **过度**。99% 用户项目未装 codegraph → 分支永远 fallback = 死代码 | **净亏**（同上） |

具体提升清单：
- ✅ 留下本档案作为"已评估外部工具"档案
- ⚠️ 不提升：`/k:spec` / `/k:plan` / `/k:task` / `/k:check` / `/k:commit` / `/k:ui` / `/k:figma` / `/k:debug-on/off` / `/k:analyze` / `/k:context-learn` / `/k:migration` —— 一律不改

### 4. 结论

**不做。** 三个理由：

1. **不是核心逻辑优化** —— codegraph 只解决"读代码结构"，不触及 soso-kit 的编排骨架
2. **会过度设计** —— detect + 双路径 + agent 教学 = 三处维护点，0 用户场景实际受益
3. **会多耗 token** —— 大库才有红利，小库下注入 prompt 反而净亏

**最克制的处置**：把本档案当作"外部工具评估归档"，不动任何命令、规则、脚本。未来若真遇到万级文件仓库分析需求，临时告诉用户 `codegraph init -i` 即可，无需 soso-kit 包装。

**一句话**：codegraph 解决万级文件仓库的探索问题，soso-kit 服务千级文件前端仓库——尺寸错位 + 用户未安装 + prompt 注入成本 = 集成净亏；最优落地是档案归档，不改代码。

### 额外 token 消耗评估

- 常驻成本：**0 tokens**（档案不进 always-on context）
- 每次推理成本：**0 tokens**
- 一次性归档成本：本文档 ~3,000 tokens（仅写入磁盘，不进上下文）

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 步骤 1-2 获取/更新 | 0 tokens |
| 步骤 3 自画像 | ~600 tokens |
| 步骤 4 扫描项目 | ~2,324 tokens |
| 步骤 6 分析阶段（含一轮自审视） | ~5,000 tokens |
| 步骤 8 文档阶段 | ~2,000 tokens |
| **总计** | **~9,924 tokens** |

---

## 变更记录

- 2026-05-21: 首次分析；含两轮自我审视，撤销 4 条过度产品化建议
- 2026-05-28: 复审（commit 02935d7）。按"是否核心优化 / 是否过度 / 是否多耗 token"三条标尺重审前版"3 个落地建议"，结论：**全部撤销，不动任何代码**。新版本（0.9.6）新增 Java/Kotlin/C++ 解析能力，但与 soso-kit 错位结论不变。
