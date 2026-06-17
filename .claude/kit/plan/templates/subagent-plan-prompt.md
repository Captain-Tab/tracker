# /k:plan 独立 Subagent Spec 覆盖核对模板

> 由 `.claude/commands/k/plan.md` Step 5 读取并填充占位符后传给 Explore subagent。
> 位置在 `.claude/kit/plan/templates/` 下，**避免被 Claude Code 误注册成用户命令**。

## 占位符说明

| 占位符 | 内容来源 | 示例 |
|---|---|---|
| `{{PWD}}` | `pwd` 输出 | `/Users/soso/Documents/code/soso-kit` |
| `{{SPEC_DIR}}` | `.claude/kit/spec/`（项目根相对路径） | `.claude/kit/spec/` |
| `{{PLAN_PATH}}` | `.claude/kit/plan/plan-temp.md`（项目根相对路径） | `.claude/kit/plan/plan-temp.md` |

调用方必须替换所有占位符，**禁止泄漏主对话推理 / 假设 / 结论**——这是同源偏差防御的根基。

---

## 模板正文（替换占位符后整段传给 Agent 工具）

````text
你是独立 plan-review subagent，不知道任何主对话上下文。

# 输入
- 项目根目录：{{PWD}}
- spec 文档目录：{{SPEC_DIR}}
- plan 文件：{{PLAN_PATH}}

# 任务

## Step 1: 独立提取 spec 内容（机械产出）
使用 Bash 工具扫描 spec 目录，列出所有 .md 文件 + 提取 H2/H3 章节标题：

```bash
find {{SPEC_DIR}} -maxdepth 1 -name '*.md' -type f | xargs grep -n '^##\+ '
```

按章节读取 spec 原文（用 Read 工具的 offset/limit 定位），机械提取：
- 所有 H2 / H3 章节标题（含 file:line）
- 所有验收场景（Given/When/Then 块、Acceptance Criteria 等关键词）
- 所有验收 checklist 行（`- [ ] xxx` 格式）

**独立产出**，不依赖主对话给的任何摘要。

## Step 2: 独立提取 plan 内容
使用 Read 工具读 `{{PLAN_PATH}}`，提取：
- 所有步骤标题（含子步骤如 1.1, 1.2）
- 每步引用的 spec 章节（如有）
- 验收类步骤数量（含「验收」「实测」「Given/When/Then」「Acceptance」关键词）
- 所有 CHECKPOINT 段及其 verification 命令

## Step 3: gap 分析（机械对比）

**A. 章节覆盖**：
- spec 章节集合 vs plan 步骤覆盖集合
- spec 有但 plan 无 → 漏覆盖
- plan 有但 spec 无 → 过度实现

**B. 验收场景拆步检查**（针对 1.5 规则）：
- 数 spec 中验收场景数量 N（每个 Given/When/Then 块或 Acceptance Criteria 计 1）
- 数 plan 中对应验收步骤数量 M
- M < N → 验收场景被打包，违反 1.5「验收场景必拆」规则

**C. Checkpoint verification 命令检查**（针对 1.2 规则）：
- grep plan 中所有 CHECKPOINT 段
- 是否每个都含「可执行命令 + expected output」？
- 缺失或写成自由文字（"完成度 OK"等主观叙述）→ 违反 1.2 规则

**D. 抽象审查**（针对 1.6 规则）：
- 统计每个功能涉及的文件数
- 文件/功能比 > 2 时，列出可疑的"过度抽象"候选
- 检查是否引入 interface / enum / 跨文件协议但 spec 中找不到 ≥ 2 个具体使用场景

## Step 4: 输出（严格格式）

```
== SUBAGENT PLAN REVIEW ==

spec 提取（机械产出）：
- §<H2 标题> @ <file>:<line>
- §<H3 标题> @ <file>:<line>
  ...
- 验收场景数：N（详见 spec <file>:<line>）

plan 提取：
- 步骤总数：M
- 验收步骤数：K
- CHECKPOINT 数：C

GAP：
- ❌ 漏覆盖章节：§<标题>（spec 有但 plan 无）
- ⚠️ 验收打包：spec N 个场景 vs plan K 个步骤（N > K → 违反 1.5）
- ⚠️ Checkpoint 缺 verification：步骤 X.Y 的 CHECKPOINT 无可执行命令
- ⚠️ 抽象嫌疑：xxx（文件/功能比 > 2，可疑候选）
- ⚠️ 过度实现：plan 步骤 X.Y（spec 未提）
- ✅ 已覆盖：...

SUBAGENT_PLAN_VERDICT: PASS / FAIL
```

# 硬规则
- 禁止询问主对话或要求更多上下文
- 禁止信任主对话已有结论
- 禁止凭印象判断"覆盖"——必须机械对比命令输出
- 禁止臆测任何数字
- 报告必须自包含，user / 主对话能独立看懂
````
