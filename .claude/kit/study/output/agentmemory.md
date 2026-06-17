# Study: agentmemory

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/rohitg00/agentmemory |
| 分析日期 | 2026-05-21 |
| Commit | bc64107 |
| 分支 | main |

---

## 核心思想与原则

**定位**：为任何 AI coding agent（Claude Code / Cursor / Codex / Cline / Gemini CLI ...）提供持久化、可搜索、跨 agent 共享的**长期记忆基础设施**。把"每次重新解释项目"的成本降为 0。

**核心原则**：

1. **Memory ≠ MEMORY.md**：内建记忆是"便利贴"，会无脑塞满 context；agentmemory 是"便利贴背后的数据库"——只把 top-K 相关项注入 prompt（92% token 节省）。
2. **认知分层（Memory Consolidation）**：模仿人脑睡眠巩固，从 Working → Episodic → Semantic → Procedural 4 层渐进沉淀。
3. **自动捕获 + 自动遗忘**：经 hook 全程零干预记录工具调用；用 Ebbinghaus 衰减 + TTL + 重要性驱逐 + 矛盾检测主动清理。
4. **来源可追溯（Provenance）**：每条 memory 链回源 observation，支持 `memory_verify`。
5. **多 agent 共生（MCP + REST + 共享存储）**：同一 memory 数据库给所有 agent 用，团队级 namespace。
6. **本地优先 + 零外部 DB 依赖**：embedding 默认走 `@xenova/transformers`（本地）；检索全在进程内 BM25 + 向量索引。
7. **韧性优先**：circuit breaker、provider fallback chain、超时短切（800–1500ms）避免在 hook 路径阻塞 agent。

---

## 核心流程

### 1) 写入管线（PostToolUse）

```
PostToolUse hook
  → POST /agentmemory/observe (3s timeout, fire-and-forget)
  → SHA-256 dedup (5min window)
  → Privacy filter（去除 secrets / API keys / <private> 标签）
  → 存原始 observation
  → LLM compress → <observation><facts><narrative><concepts><files><importance>
  → 向量 embedding（6 家 provider，本地优先）
  → 写入 BM25 + 向量索引
```

### 2) 巩固管线（Stop / SessionEnd）

```
Stop hook
  → Summarize session（episodic memory）
  → 知识图谱抽取（entity + relation，可选）
  → Slot reflection（可选）
  → 4 层巩固：Working→Episodic→Semantic→Procedural
```

### 3) 注入管线（SessionStart）

```
SessionStart hook（默认关闭 INJECT_CONTEXT，避免膨胀）
  → 加载 project profile（top concepts / files / patterns）
  → Hybrid search (BM25 + 向量 + 图)
  → RRF fusion (k=60) + session 多样性（每 session 最多 3 条）
  → Token budget（默认 2000）
  → stdout 注入到首轮对话
```

### 4) 模块全景（按 `src/` 抽样）

- **functions/**（60+ 个原子函数）：`remember / search / consolidate / crystallize / lessons / patterns / leases / actions / signals / sentinels / mesh / governance / audit / snapshot / temporal-graph` ……每个都注册为 `mem::xxx` 函数，由 `iii-sdk` 暴露成 MCP / REST。
- **hooks/**：14 类 Claude Code hook（含 `pre-compact` 在压缩前再注入记忆）。
- **state/**：自建 KV + 向量索引 + BM25 + CJK 分词 + 同义词扩展 + reranker。
- **prompts/**：六类系统 prompt（compression / consolidation / graph-extraction / reflect / summary / vision），全部 XML 严格输出。
- **providers/**：6 家 embedding + LLM provider，统一 fallback chain + circuit breaker。
- **mcp/**：51 工具 + 6 资源 + 3 prompt + 4 skill；可独立 standalone 启动。

---

## 优势与劣势

### 优势

- **生态覆盖度极高**：MCP + REST + Python/Rust/Node SDK + 主流 agent 全接入。
- **认知模型完整**：从 Working 到 Procedural 的全流程，配合衰减/版本化/supersede。
- **工程韧性强**：超时、circuit breaker、fallback chain、SHA-256 dedup、AbortSignal、不阻塞 agent 主流程（见 `session-start.ts:25-28` 对 OOM 反馈环的注释 #221）。
- **Prompt 工程严谨**：所有 LLM 出入口用 XML schema 强约束。
- **隐私默认开**：捕获时主动剥离 secrets。
- **可观测性好**：实时 Viewer（:3113）、audit trail、provenance。

### 劣势

- **重运行时**：长驻服务 + KV/向量索引 + LLM 调用 + 多 hook 进程，复杂度极高（287 个 TS 文件 + 14 类 hook + 51 个 MCP 工具）。
- **依赖链长**：embedding / iii-engine / claude-agent-sdk / 多 LLM provider，发版稳定性挑战大（最近 commit 多是 "pre-release hardening"）。
- **价值依赖 LLM 调用预算**："92% 节省"是注入侧，写入侧实际是负担转移到后台。
- **配置面庞大**：环境变量 20+ 个，新用户上手门槛高。
- **认知模型偏理想化**：4 层巩固在小项目里收益不明显。

---

## 与 soso-kit 对比

| 维度 | agentmemory | soso-kit |
|------|-------------|----------|
| **定位** | 运行时记忆数据库 / 长驻服务 | 工序化命令系统 / 编译期工具 |
| **触发方式** | hook 自动捕获 + 异步管线 | 用户主动 `/k:xxx` 命令 |
| **存储介质** | KV + 向量 + BM25 + 图（自建） | Markdown 文件 + JSON registry |
| **知识来源** | 工具调用 observation（被动） | spec / pitfall / context 录入（主动） |
| **检索方式** | RRF（BM25 + 向量 + 图） | 关键字 grep + tag + outline |
| **认知分层** | Working / Episodic / Semantic / Procedural | Feature / Pitfall（两层） |
| **版本化** | jaccard > 0.7 自动 supersede | history 数组人工维护 |
| **重要性** | importance 1-10 量表 + strength + 衰减 | 无（进入 Context 即认为重要） |
| **遗忘** | TTL + Ebbinghaus + 矛盾检测 + 容量驱逐 | `/k:context-audit` 基于 git 检测 |
| **跨 agent** | MCP + REST + 团队 namespace | 单机 .claude/ 目录 |
| **运行时依赖** | Node daemon + LLM + embedding | Bash + jq + Claude Code |

**关键观察**：两者解决的问题正交——

- agentmemory 解决"**被动捕获产生大量噪音** → 需要元数据 + 自动遗忘 + 混合检索把信噪比拉回来"
- soso-kit 解决"**用户主动整理工程知识** → 需要工序化命令把整理流程沉淀下来"

把 agentmemory 的 importance / forgetAfter / supersede / XML schema 搬到 soso-kit，等于**为不存在的问题加机制**。这正是典型的过度设计。

---

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**小。** agentmemory 的"运行时基础设施"（daemon / 向量 / 图 / hook 自动捕获 / 51 MCP 工具）与 soso-kit 的"工程化工序"定位完全正交。真正能搬过来不引入新问题的几乎为零。

之前提出的"importance / forgetAfter / supersede / XML schema"四件套，仔细推敲后都是**为 agentmemory 解决信噪比问题而存在的机制**，soso-kit 不存在这个问题：

- soso-kit 的 Context 文档是用户判断后**主动入库**的，本身就是"重要的"，再分 importance 1-10 是把不重要的事情精细化。
- forgetAfter 自动遗忘是给"被动捕获的大量观察"用的；soso-kit 文档是工程师手写沉淀，过期了用户自己会删，`/k:context-audit` 已基于 git 历史覆盖。
- supersedes 自动相似度检测的价值在于"机器从噪音中识别新旧版本"；soso-kit 当前用 history 数组人工管理够用，引入 supersedes 是双轨制。
- XML schema 的价值在于"机器解析 LLM 输出写入索引"；soso-kit 的 `/k:context-learn` 输出是给人读的 Markdown 文档，不需要机器解析。

### 2. 有必要吗？

**不必要。** 之前的"部分必要"判断是没从核心原理出发的产物。重新审视后：

- 元数据扩展（importance / forgetAfter / category / supersedes）：解决的是"被动捕获信噪比"问题，soso-kit 没有这个问题。
- XML Prompt schema：解决的是"机器解析"问题，soso-kit 没有这个问题。
- 4 层认知分层：是一个**思想启发**，但目前 features + pitfalls 两层在当前体量（~100 量级）下完全够用，硬拆 6 类反而让用户找东西时多一层维度判断。

### 3. 更新后能提升哪些？

**几乎无实质提升。** 重新评估：

- ⚠️ 不提升：检索精度（关键字够用，量级未到拐点）
- ⚠️ 不提升：审计效率（`/k:context-audit` 现有逻辑已够用）
- ⚠️ 不提升：写入体验（XML schema 反而让 LLM 输出复杂化）
- ⚠️ 不提升：跨 agent 共享（soso-kit 单机定位）
- ⚠️ 不提升：自动捕获（与 soso-kit "用户主动整理"哲学冲突）

唯一可能有价值的是**长期作为思想储备**：如果未来 Context Library 量级涨到 1000+ 或要做团队共享，再回头看 agentmemory 的认知分层和混合检索方案。但**当前不动**。

### 4. 结论

**不做。** agentmemory 是优秀项目，但它的解决方案是针对"AI 海马体"问题；soso-kit 是"工程笔记本"，没有这个问题。

具体落地：

- ❌ 不加 importance / forgetAfter / supersedes 字段（无问题可解）
- ❌ 不套 XML schema 到 `/k:context-learn`（无机器解析需求）
- ❌ 不引入 4 层认知分类（当前两层够用）
- ❌ 不做 daemon / 向量 / MCP server（与哲学冲突）
- ✅ 文档化保留：把 agentmemory 的认知分层、混合检索、自动遗忘思想记入 `study/output/agentmemory.md`，作为**未来量级到拐点时回看的参考**

**一句话**：两个项目核心原理不同——agentmemory 抗噪音、soso-kit 沉淀工程——没有共同问题就没有共同方案，当前选择"不借鉴"是从第一性原理出发的正确决策。

### 额外 token 消耗评估

- 落地成本：0（不引入任何修改）
- 文档保留成本：~0（仅本研究文档占用，不进入 always-on context）

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~2783 tokens |
| 自画像加载 | ~600 tokens |
| 分析阶段（读 README + 6 个源文件） | ~4500 tokens |
| 文档阶段（生成本文 + 反思修正） | ~5500 tokens |
| **总计** | **~13400 tokens** |

## 变更记录

- 2026-05-21: 首次分析；用户质询"是否过度设计"后修订借鉴建议为"不借鉴"（原因：未从核心原理出发，把抗噪音机制误用到沉淀场景）
