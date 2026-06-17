---
description: 提交前进行代码检查和验收
---

# 代码检查: Check

## 用户输入

```text
$ARGUMENTS
```

---

## 执行流程

> **输出原则**：过程全保留（subagent 报告 / 主 review 四维 / verify.sh 输出都正常贴）；只在**最后裁决总结**里不再复述前面已展示的内容——裁决只输出 verdict 矩阵 + 差异要点 + 决策选项。

### Step 0: 独立 Subagent 预审（默认开启，--fast 跳过）

**目的**：通过 context 隔离的 subagent 切断同源偏差——主对话的内部假设无法污染验证。

**触发条件**：`$ARGUMENTS` 字面包含 `--fast` 时跳过；否则**必须**执行。

**硬规则（AI 必须遵守，不可绕过）**：

- ❌ 禁止 AI 自作主张选择 --fast。理由「diff 简单 / 已有主对话上下文 / 节省 token / 时间」一概不接受
- ✅ 跳过 subagent 的**唯一**合法条件：用户 `$ARGUMENTS` 里字面存在 `--fast`
- 违规跳过 = 流程不完整，等同于 Step 0 失败，commit 不应基于此结果

**强制声明（执行 Step 0 之前先输出这一行）**：

```
[Subagent 模式] --fast 检测：YES / NO（依据：$ARGUMENTS = "<用户输入原文>"）
```

**执行**：

1. 收集输入：
   ```bash
   git diff --name-only HEAD
   git diff --stat HEAD
   ls -t .claude/kit/spec/*.md 2>/dev/null | head -3
   ```

2. Read `.claude/kit/check/templates/subagent-prompt.md`，取"模板正文"段。

3. 替换占位符：`{{PWD}}` / `{{CHANGED_FILES}}` / `{{SPEC_PATHS}}`。

4. Agent 工具 spawn `Explore` subagent，prompt = 替换后的模板正文。

   > 严格要求：prompt 只含模板正文 + 替换值，**禁止追加**主对话的推理 / 假设 / 结论——这是同源偏差防御的根基。

5. 等待 subagent 返回报告。记为 **`SUBAGENT_REPORT`**，提取末尾 **`SUBAGENT_VERDICT`**。

6. **报告强制段落（必须贴出 = 过程展示 + 违规检测点）**：

   **按 SUBAGENT_VERDICT 分级输出**：

   | verdict | 输出格式 |
   |---------|---------|
   | PASS | `== SUBAGENT REPORT ==`<br>`SUBAGENT_VERDICT: PASS`<br>`关键发现：✅ 无问题（一句话概括 subagent 的独立结论）` |
   | FAIL | `== SUBAGENT REPORT ==`<br>**贴完整 SUBAGENT_REPORT**（FAIL 详情是用户修复依据，必须完整） |
   | SKIPPED | `== SUBAGENT REPORT ==`<br>`SUBAGENT_VERDICT: SKIPPED`<br>`已跳过，依据：用户 $ARGUMENTS 含 --fast` |

   段落本身无论 PASS / FAIL / SKIPPED 都必须出现，缺失即视为流程不完整。**PASS 时不贴完整报告**——独立 review 通过即可，过程细节用户不需要。

> **--fast 模式**：跳过 spawn 步骤，`SUBAGENT_VERDICT = SKIPPED`，强制段落写明「已跳过」。

---

### Step 1: 主对话 Review

Read `.claude/commands/k/review.md`，按其所有步骤完整执行（包含 Step 8 完整四维报告输出）。

记为 **`MAIN_REPORT`**，提取末尾 **`MAIN_VERDICT`**。

> /k:check 不重复实现审查逻辑，单一来源在 `review.md`。
> review.md 的报告**正常输出**——这是过程，不是最终裁决。

---

### Step 1.5: 机械验证插槽（verify.sh）

**目的**：把"硬求值"外包给项目自定义的确定性工具（tsc / vitest / go vet / pytest / sqlfluff …），AI 只读退出码做裁决。

**通用约定**：`/k:check` 不绑定任何语言 / 工具，只看一个标准插槽：`.claude/kit/check/verify.sh`

**执行**：

```bash
test -x .claude/kit/check/verify.sh && echo PRESENT || echo ABSENT
# PRESENT 时：
bash .claude/kit/check/verify.sh; echo "__EXIT__=$?"
```

记为 **`MECHANICAL_VERDICT`** + 末尾输出（最多 30 行）。

| 状态 | MECHANICAL_VERDICT |
|---|---|
| 脚本不存在 | SKIPPED |
| 退出码 0 | PASS |
| 退出码 ≠ 0 | FAIL |

**报告强制段落（必须贴出 = 过程展示）**：

**按 MECHANICAL_VERDICT 分级输出**：

| verdict | 输出格式 |
|---------|---------|
| PASS | `== MECHANICAL VERIFY ==`<br>`✅ verify.sh 退出码 0` |
| FAIL | `== MECHANICAL VERIFY ==`<br>`脚本：.claude/kit/check/verify.sh`<br>`退出码：<N>`<br>`末尾输出（最多 30 行）：`<br>`<完整内容，FAIL 细节是用户修复依据，必须贴>` |
| SKIPPED | `== MECHANICAL VERIFY ==`<br>`✅ verify.sh 未配置（SKIPPED）。可选添加启用确定性验证。` |

PASS / SKIPPED 不贴末尾输出——退出码已说明一切；FAIL 时贴完整，因为错误信息是用户修复入口。

**硬规则**：

- ❌ 禁止 AI 解析 verify.sh 内容或修改它——脚本是项目级决策
- ❌ 禁止根据语义判断"测试失败可以忽略"——退出码 ≠ 0 一律 FAIL
- ❌ SKIPPED 不默认 PASS

---

### Step 2: 裁决总结（**精简输出**，不复述前面内容）

> 前面 Step 0~1.5 已经把三路过程贴完了。这里**只输出**裁决结果 + 决策选项，**禁止**复贴 SUBAGENT_REPORT / MAIN_REPORT / MECHANICAL 末尾输出——已经贴过一次就够了。

**裁决矩阵**：

| MAIN | SUBAGENT | MECHANICAL | 走向 |
|---|---|---|---|
| 全 PASS / SKIPPED | | | → Step 3（PASS） |
| 任意 FAIL，且无 PASS 冲突 | | | → Step 4（FAIL） |
| 含 FAIL 且含 PASS（互相冲突） | | | → Step 5（不一致） |

---

### Step 3: 一致 PASS → 精简总结 + Commit

**输出**（≤ 6 行）：

```
✅ /k:check PASS

| 维度       | 结论    |
| MAIN       | PASS    |
| SUBAGENT   | PASS / SKIPPED |
| MECHANICAL | PASS / SKIPPED |
```

随后 Skill 工具调用 `/k:commit`（无参数），输出 commit 建议。

---

### Step 4: 一致 FAIL → 精简问题清单

**输出**（不复贴前面报告，只列具体未通过项）：

```
❌ /k:check FAIL

| 维度       | 结论    |
| MAIN       | <P/F/S> |
| SUBAGENT   | <P/F/S> |
| MECHANICAL | <P/F/S> |

问题清单（来自前面已展示的报告，仅列条目，不复述细节）：
- <file:line> — <一句话>
- <file:line> — <一句话>
- ...

请修复后重跑 /k:check，或 /k:commit 跳过检查。
```

---

### Step 5: 不一致 → 精简差异表 + 决策选项

**输出**（**禁止**复贴 SUBAGENT_REPORT / MAIN_REPORT，因为 Step 0/1 已贴过）：

```
⚠️ /k:check 结论不一致

| 维度       | 结论    |
| MAIN       | <X>     |
| SUBAGENT   | <Y>     |
| MECHANICAL | <Z>     |

差异要点（≤ 3 条，每条 ≤ 1 行）：
- <差异点 1>
- <差异点 2>

A. 接受最严格结论（任一 FAIL → 修复后重跑）
B. 接受 MAIN 结论（说明忽略 SUBAGENT / MECHANICAL 的理由）
C. 重跑（补充上下文）
```

> MECHANICAL FAIL 时默认优先采信——退出码驱动的确定性结论，除非 verify.sh 自身有 bug。

---

### Step 6: 条件执行 Context Record

如果 `$ARGUMENTS` 包含 `--r` 且 Step 2 走到了 Step 3（一致 PASS）：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

Read `$KIT_ROOT/.claude/kit/context/action/record/WORKFLOW.md`，按其步骤执行。

---

## 使用说明

```bash
/k/check              # 默认：subagent + 主 review + verify.sh（三闸门）
/k/check --fast       # 跳过 subagent，仅主 review + verify.sh
/k/check --r          # 默认 + 通过后自动记录到 Context Library
/k/check --fast --r   # 主 review + verify.sh + 自动记录
```

> 默认开启三闸门是 soso-kit「准确优先」的体现——subagent 切同源偏差、主 review 做语义审查、verify.sh 做确定性求值，三层独立。
> `--fast` 只跳 subagent，**不**跳 verify.sh（成本低、必须跑）。
> verify.sh 由项目自决是否启用，未启用即 SKIPPED；启用后退出码 ≠ 0 即 FAIL。

> 仅需 commit 建议（无需审查）→ 直接 `/k:commit`

---

## 输出冗余检查清单（提交报告前自审）

- [ ] Step 0 输出了 `== SUBAGENT REPORT ==` 段落？（必须有）
  - PASS 时：verdict + 一句话关键发现（≤ 3 行）
  - FAIL 时：完整 SUBAGENT_REPORT
  - SKIPPED 时：1 行说明
- [ ] Step 1 输出了 review.md 完整四维报告？（过程，必须贴）
- [ ] Step 1.5 输出了 `== MECHANICAL VERIFY ==` 段落？（必须有）
  - PASS 时：1 行 `退出码 0`
  - FAIL 时：完整末尾输出
  - SKIPPED 时：1 行说明
- [ ] Step 3/4/5 裁决总结**没有**复贴前面已展示的报告内容？
- [ ] Step 5 不一致时**没有**追加长篇"裁决建议论述"——只有差异表 + ABC？

**分级原则**：PASS 时只贴 verdict，FAIL 时贴完整诊断信息（用户修复依据），SKIPPED 一行说明即可。

任何一条违反 = 输出冗余，需删改。
