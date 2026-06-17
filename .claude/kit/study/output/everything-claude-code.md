# Study: everything-claude-code

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/affaan-m/everything-claude-code.git |
| 分析日期 | 2026-04-27 |
| Commit | 4e66b28 |

---

## 核心思想与原则

**定位**：Claude Code（及多个 AI 编程工具）的"性能优化系统"。不是项目脚手架，而是一套让 AI Agent 更聪明、更一致、更安全的运行时配置集合。

**指导原则**：
1. **Instinct-first**：会话行为应自动沉淀为可复用的原子知识（instincts），而非让用户每次重新教 AI
2. **Hook-everywhere**：用 PreToolUse/PostToolUse hooks 在不增加对话成本的前提下做质量守卫、学习采集、安全扫描
3. **Cross-harness portability**：同一套 skills/rules 在 Claude Code、Cursor、Codex、OpenCode 间复用
4. **Token economics**：系统性管理 token 消耗（自动提示压缩、model 路由、背景进程）
5. **Scale via community**：183 skills + 48 agents 由社区贡献，生态网络效应是护城河

---

## 核心流程

```
会话发生
    ↓
PreToolUse hooks 触发：
  ├── pre:bash:dispatcher（质量检查、安全扫描）
  ├── pre:observe（采集工具调用到 instinct 系统）
  ├── suggest-compact（检测 token 膨胀，提示压缩）
  └── governance-capture（治理事件采集）
    ↓
PostToolUse hooks 触发：
  └── session 结束时后台 Haiku 分析 instincts
    ↓
Instinct 提炼（confidence 0.3-0.9）
    ↓
定期进化：instinct cluster → skills/commands/agents
    ↓
下次会话自动注入已学 instincts
```

**安装方式**：`npx ecc-universal` 或手动 clone，支持 selective install（manifest 驱动，按需安装组件）。

---

## 优势与劣势

### 优势
- **规模效应**：183 skills + 48 agents，覆盖从前端到 Rust/Java/Kotlin 的多语言生态
- **Hooks 系统成熟**：pre/post 双向 hooks，有 pre-bash-dispatcher 统一调度，避免 hooks 膨胀
- **Continuous Learning v2**：唯一的全自动 instinct 提炼机制，project-scoped 防止跨项目污染
- **跨工具支持**：一套规范同时覆盖多个 AI 编程工具，降低迁移成本
- **安全体系**：AgentShield + governance hooks 是专门为 AI agent 安全设计的
- **社区活跃**：170+ contributors，每月高频更新，生态持续扩展

### 劣势
- **体量过重**：整个 repo 是 1400+ .md 文件，skills/agents 大量是框架型（NestJS、PyTorch 等）而非工作流型
- **Hooks 配置复杂**：hooks.json 的 bootstrap 逻辑高度混淆（单行 node -e 命令），可维护性差
- **与具体业务解耦**：所有 skills 是通用编程技术的，没有"业务上下文管理"的概念
- **自动学习质量不稳定**：instinct confidence 阈值依赖观察频率，新项目冷启动期质量低
- **Context 系统缺失**：没有类似 soso-kit 的四层 Context Library（功能级知识库），无法管理"这个项目的这个功能是怎么做的"

---

## 与 soso-kit 对比

| 维度 | everything-claude-code | soso-kit | 启发 |
|------|----------------------|----------|------|
| 定位 | 通用 AI agent 性能优化系统 | 项目特定工作流编排（sodex 系列） | 定位互补，不冲突 |
| Skills 数量 | 183（技术框架型） | ~19（工作流型） | ECC skills ≠ soso-kit skills，性质不同 |
| 知识管理 | Instinct（自动提炼，原子级） | Context Library（手动入库，功能级） | ECC 更细粒度但无业务上下文 |
| 学习触发 | 全自动（hooks 驱动） | 半自动（/k:context-learn 手动触发） | ECC 自动化程度更高 |
| Hooks 复杂度 | 高（pre/post 双向，统一调度器） | 低（简单 hooks） | suggest-compact hook 值得借鉴 |
| Token 管理 | Suggest-compact hook + 背景进程 | Phase 分步披露 | ECC 有运行时提示，soso-kit 是设计时控制 |
| 跨工具支持 | 6 个工具 | 仅 Claude Code | soso-kit 无需跨工具 |
| 安全体系 | AgentShield + governance hooks | k:security + 恶意包规则 | 层级类似，ECC 更系统 |
| 工作流水线 | 无（平铺 skills 库） | clarify→spec→plan→task→check | soso-kit 优势明显 |
| 业务上下文 | 无 | Context Library（82 docs） | soso-kit 独有优势 |

---

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**中**。ECC 的核心创新（instinct 系统、hooks 调度器）填补的是"自动化学习"的空缺，这部分 soso-kit 靠手动 context-learn 覆盖。真正新增的价值是：
- **suggest-compact hook**：检测 token 膨胀并实时提示压缩（soso-kit 无此机制）
- **instinct confidence 模型**：atomic + weighted 的知识单元设计，可以改进 soso-kit context 文档的粒度设计

但 ECC 的 183 个 skills 对 soso-kit 没有直接价值，因为 soso-kit skills 是工作流编排型的，而 ECC skills 是技术框架参考型的。

### 2. 有必要吗？

**非必要但推荐（部分）**。suggest-compact hook 单独移植成本低、收益明确（防止 token 失控），推荐实施。instinct 全自动提炼系统实现复杂，且 soso-kit 的用户群较小（主要是个人项目），ROI 不足，暂不必要。

### 3. 更新后能提升哪些？

- ✅ **Token 控制**：移植 suggest-compact hook 逻辑到 soso-kit hooks，在 Edit/Write 高频时提示手动压缩
- ✅ **Context 粒度**：参考 instinct 的 `trigger + action + confidence + evidence` 结构，改进 context 文档模板，增加"触发场景"字段
- ✅ **会话观察**：参考 pre:observe hook 思路，在 /k:check 后自动记录本次修改的文件和模式（轻量版 instinct）
- ⚠️ 不提升：工作流水线（soso-kit 已有 clarify→spec→plan→task→check，更完整）、跨工具支持、业务 Context 管理

### 4. 结论

**部分做**，分两个层次：

**立即可做（低成本）**：
- 参考 suggest-compact hook 逻辑，为 soso-kit 添加 token 膨胀提示 hook（约半天工作量）
- 在 context 文档模板中增加 `trigger` 字段（参考 instinct 的触发器概念）

**暂缓（中成本，ROI 待评估）**：
- 自动 observe hook（全自动 context-learn），需要后台 Haiku 调用，成本需核算

**跳过**：
- Skills 库迁移、跨工具支持、ECC 2.0、governance hooks

- 成本：suggest-compact hook ~200 tokens/session（常驻极低），context 模板改进 0 额外常驻 tokens
- 收益：在长 session 中防止 token 失控，避免因 context 溢出导致的质量下降

**一句话**：ECC 与 soso-kit 定位互补而非竞争，只提取 suggest-compact hook + instinct 触发器设计思路，其余因性质差异较大跳过。

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~3,084 tokens |
| 自画像加载 | ~800 tokens |
| 分析阶段（文件读取） | ~6,500 tokens |
| 文档输出 | ~2,000 tokens |
| **总计** | **~12,384 tokens** |

---

## 变更记录

- 2026-04-27: 首次分析
