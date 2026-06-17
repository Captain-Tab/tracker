# Study: claude-mem (v13.0.1)

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/thedotmack/claude-mem.git |
| 分析日期 | 2026-05-10 |
| Commit | a10d1b34 |

---

## 核心思想与原则

claude-mem 是 Claude Code 的**跨会话记忆持久化系统**：观察 → 压缩 → 索引 → 召回。

v13 关键转折：从单机 Worker（v11/v12）演进为**插件生态 + 可选服务化**：
- Plugin/Skill 体系：11 个 SKILL.md 标准化能力定义（pathfinder/make-plan/smart-explore 等）
- Server Beta：可选 Postgres + BullMQ + Redis 队列（向规模化倾斜）
- 重许可：AGPL-3.0 → Apache-2.0
- 跨 IDE 适配：Claude Code + Codex 双市场分发

## 核心流程

### Plugin Skills 体系

```
plugin/skills/
├── pathfinder        # 编排：codebase 重构提案（features → 重复检测 → 统一架构）
├── make-plan         # 编排：实现计划生成（强制 doc 引用）
├── smart-explore     # 工具：tree-sitter AST 浏览
├── knowledge-agent   # 工具：观察语料库 → AI 会话
├── timeline-report   # 工具：项目历史叙事报告
├── babysit           # 工具：PR 监控直至 mergeable
├── version-bump      # 工具：发布流水线
└── do / learn-codebase / how-it-works / mem-search
```

每个 SKILL 用统一结构：frontmatter（trigger）→ delegation model → workflow phases → key principles → failure modes。

### Subagent 报告契约（关键创新）

pathfinder 与 make-plan 都强制：

> Each subagent response **must** include:
> 1. Sources consulted — exact file paths and line ranges read
> 2. Concrete findings — exact function names, call sites, data flow
> 3. Mermaid diagram(s) with nodes labeled by `file:line`
> 4. Confidence note + known gaps
>
> **Reject and redeploy the subagent if it reports conclusions without sources.**

### Smart-explore 三层模型

```
smart_search   ← 一次扫整个目录，返回符号 + folded view
smart_outline  ← 单文件结构骨架
smart_unfold   ← 按符号名展开完整源码
```

底层用 tree-sitter AST，支持 10+ 语言。token 经济（实测）：

| 方法 | tokens |
|------|--------|
| smart_outline | 1k-2k |
| smart_unfold | 0.4k-2.1k |
| Read 整文件 | 12k+ |
| Explore agent | 39k-59k |

## 优势与劣势

### 优势

- **Skill frontmatter 标准化**：每个能力都是结构化定义，AI 可发现、可触发
- **强制证据**：subagent 契约让幻觉难以蒙混过关
- **AST 优先**：smart-explore 用 tree-sitter 而非 grep，多语言通用
- **生态扩展**：从单工具变成插件市场（thedotmack/claude-mem）

### 劣势

- **复杂度爆炸**：443 个 ts 文件，普通用户难以全貌掌握
- **运行时依赖**：Server Beta 需要 Postgres+Redis，单机用户被动加复杂度
- **重 IDE 锁定**：hooks 命令长达数百字符的环境探测脚本，跨 IDE 维护成本极高

## 与 soso-kit 对比

| 维度 | claude-mem v13 | soso-kit | 启发 |
|------|---------------|---------|------|
| 定位 | 跨会话记忆持久化 + 工作流插件 | 单会话工作流编排 | 不同问题域 |
| 运行时 | Worker daemon + 可选 Postgres+Redis | 纯 shell + jq | soso-kit 零依赖优势 |
| 能力发现 | Skill frontmatter（trigger 关键词） | skill 描述 | soso-kit 已类似 |
| 证据要求 | 强制 file:line subagent 契约 | plan.md 已强制 + 禁词列表 | **soso-kit 更细** |
| 代码浏览 | Smart-explore（tree-sitter AST） | outline.js（TS Compiler API） | **soso-kit 对 TS 更准** |
| 子 agent 编排 | pathfinder/make-plan 多 agent fan-out | 主 AI 直接执行，无 subagent | 架构不同，无对接面 |
| 跨会话 | 是（核心能力） | 否（context-library 手动持久化） | 不同问题域 |
| 目标用户 | 团队 + 长期项目 | 个人 + 单项目 | 单人不需要规模化 |
| 依赖 | Node、Bun、可选 Postgres | bash、jq、git | 零依赖是 soso-kit 红线 |

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**几乎为 0**。逐项核查：

| claude-mem v13 特性 | soso-kit 现状 |
|--------------------|--------------|
| Subagent 报告契约（file:line 引用） | `plan.md:285` 已强制 + 禁词列表，比 claude-mem 还细 |
| Smart-explore（tree-sitter） | `outline.js` 用 **TypeScript Compiler API**，对 TS 比 tree-sitter 更精准 |
| Pathfinder 多 agent 编排 | soso-kit 不用 subagent 模式（主 AI 直接执行） |
| Mode 配置 + i18n 变体 | 单人单项目不需要分场景 |
| Knowledge-agent | 强依赖 claude-mem 观察数据库 |
| Timeline-report | 强依赖 SQLite 观察存储 |
| Server Beta（Postgres + BullMQ） | 与零依赖定位冲突 |
| 内容哈希去重 / 一致性校验 / 原子写入 | **v11 study 已借鉴并应用** |

### 2. 有必要吗？

**不必要**。原因：

- **架构不匹配**：claude-mem 的核心创新（subagent 契约）服务于多 agent 编排，soso-kit 不用
- **现有方案更优**：TS Compiler API 比 tree-sitter 对 TypeScript 更准；plan.md 的禁词列表比 claude-mem 契约更细
- **定位冲突**：Server Beta、worker 守护、向量存储——和"零依赖 shell + 单人定位"完全相反

### 3. 更新后能提升哪些？

- ⚠️ **不提升**：本次 study 未识别出新的有效借鉴点
- ⚠️ **已借鉴部分**：之前 v11 study 已落地的内容哈希、一致性校验、原子写入正在 production 中（首次运行就发现 3 个真实数据问题）
- ✅ **唯一收益**：确认 soso-kit 在"证据契约"和"TS 代码浏览"两个维度已超越 claude-mem v13，避免后续重复研究

### 4. 结论

**不做**。本次研究的实际产出是**反向确认**：

- soso-kit 在它关心的维度上已优于 claude-mem
- claude-mem v13 的新东西（Plugin Skills、Server Beta、Smart-explore）属于不同问题域或更弱方案
- 之前 v11 study 提取的 3 个工程化点（哈希/校验/原子写）已是该 repo 全部值得借鉴的内容

**成本**：0 token（不做修改）
**收益**：避免下次重复研究 claude-mem 浪费的 token

**一句话**：claude-mem v13 走向规模化 + 多 agent 编排，soso-kit 走向单人 + 单 AI 主控，两条路径——这次 study 的结果是"无需行动"，并把这个判断固化到文档里防止重复评估。

## 变更记录

- 2026-05-10: 初次分析（v13.0.1，commit a10d1b34）
