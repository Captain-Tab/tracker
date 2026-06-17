# Study: pi-autoresearch

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/davebcn87/pi-autoresearch.git |
| 分析日期 | 2026-04-16 |
| Commit | 5a29db0 |

---

## 核心思想与原则

**核心理念**：闭环自主优化——让 AI 代理在无人监督的情况下持续改进代码，永不停歇。

四条核心原则：

1. **指标至上**：一切决策由可量化的 primary metric 驱动（更低 / 更高），主观判断让位于数据
2. **Git 即状态机**：keep = 自动 commit，discard = 自动 revert，代码状态与实验结果严格绑定
3. **会话可恢复性**：`autoresearch.md` 是"时间胶囊"，任何 fresh agent 读完即可接力继续
4. **噪声感知**：置信度评分 = `最佳提升 / 噪声基线`，区分真实改进与随机波动

---

## 核心流程

```
用户: /autoresearch optimize X
        ↓
autoresearch-create (Skill)
  ├── 询问/推断：目标、命令、指标、文件范围
  ├── git checkout -b autoresearch/<goal>-<date>
  ├── 阅读源码，理解工作负载
  ├── 写 autoresearch.md + autoresearch.sh + 提交
  └── init_experiment → 运行 baseline → log_experiment
        ↓
自主循环 (Extension Tools)
  ┌─> 改代码
  ├── run_experiment(command)
  │     ├── 执行命令，计时，捕获输出
  │     ├── 解析 METRIC lines
  │     └── 可选：运行 checks.sh
  ├── AI 判断 keep / discard
  ├── log_experiment(commit, metric, status, description, asi)
  │     ├── keep → git commit 自动保留
  │     └── discard/crash → git revert 自动回退
  │         （autoresearch 文件不受影响）
  └─> 继续循环（NEVER STOP）
        ↓
autoresearch-finalize (Skill)
  ├── 读 autoresearch.jsonl，筛出 kept 实验
  ├── 按文件无交集原则分组
  ├── 用户确认分组方案
  └── 每组从 merge-base 建独立分支 → 可直接 PR
```

**关键设计细节**：
- `autoresearch.jsonl`：append-only 日志，记录每次实验的完整上下文（含 ASI）
- `autoresearch.ideas.md`：灵感备忘录，上下文重置后不丢失想法
- 输出截断（10行 / 4KB）：防止长输出淹没 agent 上下文
- Segment 机制：`init_experiment` 可多次调用，每次重置 baseline，适用于不同优化阶段

---

## 优势与劣势

### 优势

- **完整闭环**：从发起实验到整理 PR，端到端自动化，几乎不需要人介入
- **状态持久化设计精良**：`autoresearch.md` + `autoresearch.jsonl` 确保上下文丢失后可无缝恢复
- **置信度量化**：主动区分有意义的改进与噪声，避免优化幻觉
- **ASI 机制**：结构化记录"失败原因"，防止重复踩坑
- **finalize 分支整理**：将混乱的实验提交拆成干净、可审查的独立 PR
- **双向安全**：checks.sh 提供正确性回压，保证实验不破坏正确性

### 劣势

- **绑定 pi.dev 平台**：依赖 `@mariozechner/pi-coding-agent` 等专有包，不可移植到 Claude Code
- **无任务分解**：loop 是单层结构，缺乏 plan→task 的层次化分解能力
- **指标定义门槛**：用户需要自己写 `autoresearch.sh` 并输出 `METRIC` 格式，有一定上手难度
- **缺乏 Context 库**：没有跨项目的知识沉淀机制，每次实验的洞察局限在当前会话
- **有限的工作流**：只覆盖"自主优化"这一个场景，不支持 spec/review/debug 等其他工程工作流

---

## 与 soso-kit 对比

| 维度 | pi-autoresearch | soso-kit | 启发 |
|------|-----------------|----------|------|
| **定位** | 自主优化循环（单一场景，极致深度） | 工程工作流编排（多场景，覆盖广） | 两者互补而非替代 |
| **驱动方式** | 指标数值（客观量化） | AI 分析 + 用户确认 | 量化驱动可用于 check/review |
| **持久化层** | autoresearch.md（轻量会话文档）+ JSONL 日志 | Context Library（结构化知识库） | JSONL 日志思路值得借鉴 |
| **失败记录** | ASI（每次实验附加诊断）+ ideas.md | context-pitfall（跨项目陷阱库） | ASI 比 pitfall 更细粒度 |
| **工作流粒度** | 单循环（experiment loop） | 多阶段流水线（clarify→spec→plan→task→check） | pi 单一但自治，soso-kit 多元但需介入 |
| **可恢复性** | autoresearch.md 让任意 fresh agent 接力 | plan-temp.md 保存执行状态 | soso-kit 会话恢复可强化 |
| **结果整理** | autoresearch-finalize 分 PR | /k/check 验收 | finalize 思路可用于 migration |
| **置信度量化** | 内置噪声基线 × 置信度评分 | 无 | 可引入不确定性量化 |
| **平台依赖** | 强依赖 pi.dev | Claude Code + Shell | soso-kit 更通用 |

---

## 借鉴建议

### 裁决摘要

| 建议 | 裁决 | 原因 |
|------|------|------|
| ASI 模式 → task checkpoint | ✗ 跳过 | pitfall 已覆盖，增加 token |
| 置信度量化语言 | ✗ 跳过 | Claude 自然语言已具备 |
| finalize 思路 → migration | ~ 低优先级 | 对 /k/migration 有价值，非紧急 |

**总体：借鉴价值有限，归档参考即可。**

### 详细分析

**ASI 模式 → 强化 context-pitfall（中高价值）**

pi-autoresearch 的 ASI 是"每次行动后记录结构化诊断"，与 soso-kit 的 pitfall 概念互补。可在 `/k/task` 的 checkpoint 步骤引入"本批次学到了什么"的结构化记录。但 pitfall 库已有类似功能，重复建设意义不大。

**置信度量化 → 引入不确定性语言（低成本）**

当 AI 对方案有多个选择时，引入量化不确定性标注。Claude 本身已会表达不确定性，无需额外机制。

**autoresearch-finalize 思路 → 强化 migration 分支整理（中值）**

finalize 的核心是"从混乱分支按文件无交集原则拆出独立 PR"，与 `/k/migration` 的批次拆分需求高度相关。可在 migration 工作流末尾增加整理步骤，但优先级较低。

### 额外 token 消耗评估

| 改动 | 预估额外消耗 |
|------|-------------|
| ASI → task checkpoint 记录 | +200~500 tokens/任务（可选触发） |
| 置信度语言规范 | 0（仅行为规范，无额外读取） |
| finalize 思路移植 | 仅在 migration 末尾触发，+1000 tokens/次 |

---

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~1916 tokens |
| 分析阶段 | ~3000 tokens |
| 文档阶段 | ~800 tokens |
| **总计** | **~5716 tokens** |

## 变更记录

- 2026-04-16: 首次分析
- 2026-04-16: 更新分析（验证裁决表前置流程）
