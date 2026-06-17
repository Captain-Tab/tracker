# Study: Understand-Anything

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/Lum1104/Understand-Anything |
| 分析日期 | 2026-05-28 |
| Commit | 26edf61 |
| 分支 | main |

---

## 核心思想与原则

**"用知识图谱替代盲读代码"** —— 把任意 codebase 转换成可探索、可搜索、可问答的交互式知识图谱。

设计原则：
- **多 agent 流水线**：拆成 7 个有界 phase（scan → batch → analyze → assemble → architecture → tour → review → save），每个 phase 由专门 subagent 负责
- **图谱即数据**：统一 schema（13 种节点类型 + 26 种边类型），LLM 输出经确定性脚本归一化、去重、修复
- **增量优先**：fingerprint + git diff 实现增量更新，避免每次全量重跑
- **多平台中性**：同一份 skills/agents 同时支持 7 个 IDE/CLI（Claude Code、Codex、Cursor、Copilot、Gemini CLI、OpenCode、Vibe、Trae）
- **可视化输出**：除文本图谱外，提供 React dashboard（force-directed graph + 引导式 tour）

## 核心流程

```
Phase 0   pre-flight：检测 worktree、build plugin、决定 full/incremental
Phase 0.5 .understandignore 配置
Phase 1   SCAN     project-scanner → 文件清单 + import map
Phase 1.5 BATCH    compute-batches.mjs → 语义分批（按依赖聚类）
Phase 2   ANALYZE  并发 ≤5 个 file-analyzer subagent → 每批输出 GraphNode/GraphEdge
Phase 3   ASSEMBLE 合并 batch → 归一化 ID/复杂度/test 边 → assemble-reviewer 复核
Phase 4   ARCHITECT architecture-analyzer → 推断分层（按 language/framework 注入上下文）
Phase 5   TOUR     tour-builder → 生成依赖顺序的引导步骤
Phase 6   REVIEW   inline 校验脚本 或 graph-reviewer subagent
Phase 7   SAVE     写 knowledge-graph.json + meta.json + 指纹基线 → 启动 dashboard
```

**关键工程细节**：
- 节点 ID 归一化（双前缀剥离、相对路径加前缀、复杂度枚举映射）放在合并脚本里，LLM 不需要保证完全格式正确
- `tested_by` 边走二阶段：LLM 输出 + 路径约定 fallback
- 增量更新时保留 `batch-existing.json` 与新批次一起进合并脚本
- Worktree 自动重定向到主仓库根（避免 graph 被 worktree 销毁）
- 指纹基线必须在 `meta.json` 写入前生成成功（否则下次增量会误判全量）

## 优势与劣势

### 优势
- **图谱 schema 严谨**：13 节点 + 26 边覆盖 code/config/doc/infra/data 多维度，确定性归一化弥补 LLM 输出漂移
- **工程纪律好**：LLM 不可靠的地方（ID 格式、去重、test 边方向）全用确定性脚本兜底
- **批处理可扩展**：100+ 文件并发 5 subagent，单次运行可处理大型仓库
- **多平台中性**：一份代码跨 7 个 IDE/CLI 分发
- **可视化降低门槛**：dashboard 比纯 markdown 更直观，对 onboarding 友好
- **增量机制完善**：fingerprint baseline + git diff 实现精准增量

### 劣势
- **重量级依赖**：需要 Node ≥ 22 / pnpm ≥ 10 / 构建 `@understand-anything/core`
- **单向产出**：图谱是只读分析结果，不参与代码生成/修改工作流
- **首次分析昂贵**：大型项目需并发跑多个 LLM batch
- **Dashboard 维护成本**：React 前端需持续跟进可视化库版本
- **缺少"任务执行"闭环**：只回答"代码是什么"，不回答"接下来做什么"

## 与 soso-kit 对比

| 维度 | Understand-Anything | soso-kit | 启发 |
|------|---------------------|----------|------|
| 定位 | 探索型：codebase → 交互式图谱 | 工作流型：需求 → 代码 全流程 | 互补，不冲突 |
| 主要产物 | knowledge-graph.json + dashboard | spec/plan/task/context 文档 | 路线不同 |
| 多 agent | 8 个 subagent 串/并行 | /k:analyze-live 已有多 agent 静态+运行时 | 思路一致 |
| 结构化数据 | 13 节点 × 26 边 schema | Context Library（markdown + tag） | 不借鉴（侧支精细化） |
| 增量机制 | fingerprint + git diff | /k:context-audit（git log 检测） | 心法学，不落地 |
| 跨平台 | 7 个 IDE/CLI | 仅 Claude Code | 暂无需求 |
| 可视化 | React dashboard | 无 | 不做完整版，可考虑 mermaid 轻量版 |
| 实现栈 | Node + pnpm + TypeScript | bash + jq + .md | soso-kit 更轻 |
| 工作流闭环 | 单向（分析→图谱） | clarify→spec→plan→task→check 闭环 | soso-kit 强项 |

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**小**。两个项目定位差异大：UA 是"读懂代码"，soso-kit 是"完成需求"。UA 的多 agent / 增量 / 模块化思路 soso-kit 已基本覆盖（/k:analyze-live、/k:context-audit、/k:context-learn）。

真正可吸收的是**抽象方法论**（不是具体功能）：
- 确定性脚本兜底 LLM 输出
- "增量三段式" = git diff + 指纹 + 归一化合并
- 产物 schema 化 + 校验前置

### 2. 有必要吗？

**不必要**。所有候选借鉴点经过逐项审视后：
- **图谱 schema**：是侧支精细化，维护成本 > 查询收益
- **fingerprint 增量**：与 soso-kit "Context 是手写文档而非自动产物" 的本质不匹配；引入 tree-sitter 等于把 bash 项目变 Node 项目，违反 shell-first 哲学
- **Dashboard**：与工作流定位不符，完整实现工作量按周算
- **多 agent 流水线**：已有
- **多平台分发**：暂无需求

### 3. 更新后能提升哪些？

- ⚠️ **不提升**：clarify/spec/plan/task/check 工作流（UA 无此层）
- ⚠️ **不提升**：UI / Figma / migration 等专项命令（与 UA 无交集）
- ⚠️ **不提升**：核心结构 —— UA 的优势在产物丰富度，soso-kit 的优势在工作流闭环，互不交叉
- ✅ **抽象层提升**：未来写新命令时，可主动套用"LLM 输出 → 确定性脚本归一化 → 校验"的三段式（这是心法，不需要改任何现有文件）
- ✅ **可选轻量项（按需）**：在 `/k:context list` 加 mermaid 关系图输出（成本 +500 token/次，仅在用户主动想要可视化时启用）

### 4. 结论

**不做主体借鉴，仅吸收方法论**。

具体落地：
- ❌ 不引入 UA 整体框架（Node/React 依赖与 bash-first 冲突）
- ❌ 不做 dashboard 完整版
- ❌ 不加 relations 字段到 Context schema
- ❌ 不引入 tree-sitter 指纹
- ✅ 心法吸收："确定性脚本兜底 LLM 输出" 在未来写命令时自然套用
- ✅ 待定（P4）：mermaid 轻量可视化（仅在有用户反馈说"看不懂功能关系"时再做）

**成本**：常驻 0 tokens；不改动任何现有规则/命令
**收益**：方法论沉淀，未来命令质量更稳

**一句话**：UA 是优秀的代码探索工具，但 soso-kit 是代码生产工作流，两者无核心结构层面的可迁移点；真正值得学的是工程纪律（确定性脚本 + 增量三段式 + 产物 schema 化），而非任何具体功能。

### 额外 token 消耗评估

- 不采纳主体：**0 tokens**
- 仅吸收方法论：**0 tokens**（不改任何文件）
- 若未来按需加 mermaid 轻量版：每次调用 +500 token，常驻 0

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~2.6K tokens |
| 分析阶段 | ~10K tokens（读 SKILL.md + plugin 结构） |
| 文档阶段 | ~3K tokens |
| **总计** | **~15.6K tokens** |

## 变更记录

- 2026-05-28: 首次分析
