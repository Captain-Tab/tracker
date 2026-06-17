---
module: rules-sodex-next
type: rules
version: 1.0.0
released: 2026-05-09
versioning: semver
status: active
source: .claude/rules/modules/sodex-next/
---

# Rules / sodex-next 变更日志

> 版本约定：SemVer，第一个 `## v<x.y.z>` 即当前版本。
>
> 本模块管理 sodex-next 项目的 always-on 规则集。规则总量直接影响每次对话的固定 context 开销，瘦身/重定位是主要演进方向。

## v1.0.0 - 2026-05-09

### 🗑️ 移除：event-driven.md（30 行 → 迁 pitfall）

**背景**：审视 sodex-next/rules/ 总量（14 文件 / 882 行 always-on / ~22K tokens 每对话）。`event-driven.md` 属于「设计审查类」规则——需要 LLM 先识别"这是事件驱动方案"才会自检，always-on 注入只让 LLM "读到"，不能保证"执行"。

**核心判断**：

> always-on ≠ 规则生效。规则放在哪个时机比压几行更重要。

**规则按性质分类**（用于决定归宿）：

| 类型 | 特征 | 最佳归宿 |
|------|------|----------|
| A. 编码常驻 | 每行代码都用得上、可机械对照 | always-on |
| B. 路径触发型 | 特定路径 CRUD 时触发 | always-on（短）或 PostToolUse hook |
| C. 时机明确 | 提交时 / 装包时 / 检查时 | 挂到 `/k:check` 或对应 hook |
| **D. 设计审查类** | 需语义判断"是不是这种方案" | **pitfall (gate:true)** ⭐ 本次 |
| E. 厚但触发窄 | 仅特定场景使用 | skill / on-demand load |

### 🔄 内容去向：pitfall `event-driven-three-dimensions`

**位置**：`.claude/kit/context/library/sodex-next/pitfalls/event-driven-three-dimensions.md`

**关键配置**：

- `gate: true` — 自动成为 `/k:plan` 阶段预检门
- `trigger: [eventBus, emit, on(, 事件, 轮询, polling, websocket, 推送, native_transfer, callback, 回调, ...]` — 13 个关键词匹配 spec/plan 内容
- `gate_rule: 方案依赖事件驱动…必须逐项审查三维度`

**生效路径**：

```
/k:plan 描述方案
  → query-pitfall-gates.sh 按内容匹配 trigger
  → 命中 → 输出门检查项，要求 plan 标注如何避免
  ↓
/k:check 复查
  → CHK-04b 自动核对 gate_rule 是否被遵守
```

**为什么 pitfall 优于 principles + plan checklist 方案**：

| 维度 | principles + 手改 plan | **pitfall (本次方案)** |
|------|------------------------|----------------------|
| 触发机制 | 需手维护 plan 模板 | ✅ gate 系统已有 |
| `/k:check` 联动 | 需另加 CHK 项 | ✅ CHK-04b 已自动跑 |
| 可发现性 | 散落 principles 目录 | ✅ `/k:context-pitfall` 标准查询 |
| 与历史 case 关联 | 仅预防文档 | ✅ 同时承载 3 个真实历史案例 |
| 维护点 | 多处同步 | ✅ 单点（pitfall md + add-to-index 脚本） |

### 历史案例（迁入 pitfall）

迁移过程中把原规则的 3 个例子升级为完整历史 case 描述：

1. **WS + 轮询双触发** → `DEPOSIT_RECORD_REFRESH` 重复处理
2. **payload 区分度不足** → `NATIVE_TRANSFER_ARRIVED` 弹窗误触发非 deposit 操作
3. **状态覆盖** → `completed → waiting` 逆向覆盖

### 反思：为什么之前 always-on 注入不够好

复盘中识别的关键认知：

1. **触发能力 ≠ 注入数量**：always-on 只是把规则塞进 context，LLM 在编码时是否主动应用是另一回事。设计审查类规则需要"先识别场景"再"执行检查"，第一步就靠不住。
2. **时机错位**：事件驱动审查是**设计阶段**的事，always-on 给的是**编码阶段**的提醒。即使被读到，时机也不对——已经在写代码了。
3. **pitfall 的 gate 系统是为这类需求设计的**——`gate: true` + `trigger` 关键词匹配 + `/k:plan`/`/k:check` 双重联动，已经覆盖"识别 + 检查 + 复查"全链路。

### 已知局限

- `trigger` 关键词依赖 spec/plan 显式提到 "事件" / "eventBus" 等词；用户写 spec 时只描述功能不提技术 → 可能不命中
- 这是所有 trigger-based 系统共性问题，但比 always-on 可靠在于命中后**强制走流程**

### 后续可考虑的同类迁移

| 文件 | 行数 | 性质 | 候选归宿 |
|------|------|------|---------|
| `sync-data-map.md` | 10 | 路径触发型 | PostToolUse hook 或 `/k:check` diff 检查（**保留 always-on 也可，已有 62% 实测覆盖率**） |
| `auth.md` | 256 | 厚但触发窄 | skill / on-demand load（节省最大） |
| `malicious-npm-package.md` | 36 | 装包时触发 | preinstall hook |
| `git-commit.md` | 87 | 提交时触发 | commit hook 或 `/commit` skill |

潜在节省：~419 行 / ~10K tokens 每对话。

### 迁移产物清单

- ❌ 删除：`.claude/rules/modules/sodex-next/event-driven.md`
- ✅ 新增：`.claude/kit/context/library/sodex-next/pitfalls/event-driven-three-dimensions.md`
- ✅ 同步：`pitfalls/index.json` + `pitfalls/index.md`（通过 `add-to-index.sh`）
