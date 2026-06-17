# Study: TencentDB-Agent-Memory

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/Tencent/TencentDB-Agent-Memory |
| 分析日期 | 2026-05-28 |
| Commit | 438869b |
| 分支 | main |

---

## 核心思想与原则

**"让 Agent 记住该记的事，让人不必重复自己。"**

- 拒绝"扁平向量堆"，采用**分层记忆**（layering）：长期、短期、技能三条线都按层次组织。
- 拒绝"不可逆压缩"，采用**符号化 + 可下钻**：上层留高密度符号，下层留原始证据。
- **异构存储**：底层事实/日志/trace 入数据库（SQLite + sqlite-vec），上层 persona/scene/canvas 落 Markdown，便于人工阅读与白盒检查。
- **宿主中立**（host-neutral）：核心 `TdaiCore` 通过 `HostAdapter` 接口同时服务 OpenClaw（in-process）与 Hermes（HTTP Gateway）。

## 核心流程

### 1. 长期记忆四层金字塔（L0 → L3）

```
L0 Conversation  原始对话（refs/*.md, jsonl）
L1 Atom          原子事实（LLM 抽取）
L2 Scenario      场景块（scene_blocks/*.md, LLM 沙箱写入）
L3 Persona       用户画像（persona.md，统一入口）
```

- 召回时只读上层（Persona/Scene 摘要），细节按 `node_id` grep 下钻到 L0 原文。
- 触发：L1 由 capture 钩子驱动，L2 由"null entry 阈值 + 超时"独立触发，L3 由 scene 数量阈值驱动。
- 沙箱：SceneExtractor 的 `workspaceDir = scene_blocks/`，LLM 只能读写 scene 文件，看不到 checkpoint/persona/index。

### 2. 短期记忆 Mermaid 符号画布

```
Verbose Logs ──1.offload──▶ External FS (refs/*.md)
            └─2.extract──▶ Mermaid Canvas (with node_id)
                                  │
                          3.light inject
                                  ▼
                            Agent Context
                                  │
                          4.grep node_id
                                  ▼
                            Recall raw text
```

- 工具调用产生的长输出被 offload 到外置文件，上下文只保留 Mermaid 状态转移图（带 `NNN-N<seq>` 形式 node_id）。
- 每个 node_id 是双向锚点：符号图引用 → grep refs → 拿回完整原文。

### 3. 双宿主适配

| 入口 | 路径 | 进程模型 |
|------|------|----------|
| OpenClaw | `OpenClawHostAdapter`（in-process） | 插件随宿主进程 |
| Hermes | `StandaloneHostAdapter`（HTTP `:8420`） | 独立 Gateway，多客户端共享 |

`TdaiCore.handleBeforeRecall / handleTurnCommitted` 是统一入口，调用方用哪种 adapter 都拿到同一套能力。

### 4. 关键工程要点

- **并发安全**：scheduler 启动用 Promise gate 防止 Gateway 高并发时 `start()` 覆盖已有 session 状态。
- **可追溯压缩**：所有"上层符号 → 下层证据"路径不可逆压缩，必须可回溯。
- **指标上报**：每个 pipeline（L1/L2/L3）独立 reporter，便于观测哪一层瓶颈。

## 优势与劣势

### 优势
1. **数据结构严谨**：L0-L3 + node_id 锚点的设计经得起推敲，不是"先 embed 再 cos sim"那种粗糙方案。
2. **可观测、可回溯**：上层符号可读，下层证据可 grep，调试链路完整。
3. **基准成绩可验证**：WideSearch +51.52% pass / −61.38% tokens、PersonaMem 48%→76%，论文级别的硬指标。
4. **宿主解耦做得彻底**：HostAdapter / LLMRunner / SessionFilter 三道接口，迁移成本可控。
5. **本地优先**：默认 SQLite + sqlite-vec，零外部依赖即可起步。

### 劣势
1. **复杂度高**：四层 pipeline + 多触发器 + checkpoint + backup + sandbox，每一项都需要独立测试与运维。
2. **强依赖 LLM**：scene 抽取、persona 生成、L2 mermaid 都跑独立 LLM 调用，本地成本不低。
3. **运行时定位**：必须有 host runtime（OpenClaw / Hermes），无法作为静态工具集使用。
4. **生态绑定**：当前主推 OpenClaw + Hermes，对其他 agent 框架（Claude Code、Cursor、LangGraph）需要自写 adapter。

## 与 soso-kit 对比

| 维度 | TencentDB-Agent-Memory | soso-kit | 启发 |
|------|------------------------|----------|------|
| 定位 | Agent 运行时记忆插件 | Claude Code 工作流命令集 | 不同抽象层 |
| 运行形态 | Node.js 进程 + SQLite + LLM | bash 脚本 + .md prompt | 不同技术栈 |
| 记忆载体 | 自动捕获的对话/工具日志 | 人工/半自动写的工程文档 | 输入源不同 |
| 召回机制 | 向量检索 + node_id 下钻 | grep + tag + 四层渐进披露 | 思路相通，实现不同 |
| 上下文压缩 | Mermaid 符号 + offload 到 refs | 文档分层（index/router/sections/full） | 都是渐进披露 |
| 写入安全 | LLM 沙箱 workspaceDir | git + 用户审阅 | 兜底机制不同 |
| 主要痛点 | Agent 长 horizon token 爆炸 | Context 与代码漂移 | 问题域不重叠 |

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**小**。覆盖率评估：

- 它解决的"运行时 agent 工具日志膨胀"问题，soso-kit 的宿主（Claude Code）自带上下文管理，**问题不存在**。
- 它的"跨会话用户偏好沉淀"问题，soso-kit 已用 `memory/MEMORY.md` + Context Library 解决，**已覆盖**。
- 真正新增的仅是"node_id 双向锚点"这一微观惯例——而 `/k:context unfold` 已能做摘要↔全文切换，差异边际。

### 2. 有必要吗？

**不必要**。理由：
- soso-kit 不是 agent runtime，没有"工具日志撑爆上下文"这个根问题。
- 引入向量检索 / SQLite / LLM pipeline 对一个 bash + .md 工具集是数量级的复杂度抬升。
- 现有的 grep + tag + 渐进披露对 30-40 个 context 文档的规模已经足够，向量化 ROI 为负。

### 3. 更新后能提升哪些？

- ⚠️ 不提升：L0-L3 分层、Mermaid offload、向量检索、SQLite 后端 —— 全部不引入。
- ✅ 微观可借（低优先级）：
  - `node_id` 双向锚点格式（`NNN-N<seq>`）→ 未来 `/k:context unfold` 迭代时可参考，让"摘要中的引用 ↔ 全文段落"用统一锚点 ID 而非 anchor 文本匹配。
  - LLM 沙箱化写入（限定 `workspaceDir`）→ `/k:context-learn` 自动写 context 文档时可考虑加一道写入边界，但当前用户主导 + git 兜底已够。

### 4. 结论

**不做整体借鉴。** 仅记录两个微观启发点待后续命令迭代时评估，不动现有规则与命令。

- 成本：常驻 0 tokens（不引入规则），未来局部迭代时一次性参考。
- 收益：保留对"双向锚点"设计的认知储备。

**一句话**：原理优秀但定位错层，对一个"AI 工作流脚本集"而言是工业级 agent runtime 的过度设计，跳过整体借鉴，只把 node_id 锚点思路放进笔记。

### 额外 token 消耗评估

| 引入项 | 常驻 token 增量 | 每次推理增量 | 决策 |
|--------|----------------|--------------|------|
| L0-L3 pipeline 规则 | +800~1200 | 0 | ✗ 不引入 |
| Mermaid 画布规则 | +400 | +200~500/会话 | ✗ 不引入 |
| 向量检索 schema | +200 | 0 | ✗ 不引入 |
| node_id 锚点惯例 | +100（仅在 unfold 文档内） | +50 | ~ 待后续评估 |

整体引入会带来 1.5k+ 常驻 token 增量且无对应收益；保持现状。

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~3173 tokens |
| 分析阶段 | ~2200 tokens |
| 文档阶段 | ~1800 tokens |
| **总计** | **~7173 tokens** |

## 变更记录

- 2026-05-28: 首次分析
