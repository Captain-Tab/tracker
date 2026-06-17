---
description: 检测 Context 文档是否需要更新（基于 git 历史，零 token 检测）
---

# Context Audit

## 用户输入（Feature ID）

```text
$ARGUMENTS
```

---

## Step 0: 初始化

`AUDIT_FEATURE_ID` = `$ARGUMENTS`

**使用 Bash 工具**找到 KIT_ROOT：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && echo "KIT_ROOT=$KIT_ROOT"
```

若 KIT_ROOT 为空，输出 `❌ 未找到 context library，请确认 .cursor 目录已同步` 后结束。

若 `AUDIT_FEATURE_ID` 为空，输出 `❌ 缺少参数: feature-id  用法: /k/context audit <feature-id>` 后结束。

设置项目目录变量：

```bash
PROJECT_NAME=$(ls "$KIT_ROOT/.claude/kit/context/library/" | head -1)
CONTEXT_PROJECT_DIR="$KIT_ROOT/.claude/kit/context/library/$PROJECT_NAME"
```

---

## Step 0b: 跨文件一致性校验

**使用 Bash 工具**：

```bash
bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/validate-structure.sh" \
    --integrity "$CONTEXT_PROJECT_DIR"
```

- 校验通过 → 继续 Step 1
- 校验发现问题 → 展示给用户并提示：`⚠️ 索引存在一致性问题，建议先修复再继续审计。`（不阻塞，继续 Step 1）

---

## Step 1: 执行 git 历史检测（零 token）

**使用 Bash 工具**：

```bash
bash "$KIT_ROOT/.claude/kit/context/action/audit/scripts/check-git-history.sh" \
    "$AUDIT_FEATURE_ID"
```

将脚本完整输出展示给用户，**不做任何 AI 分析**，仅呈现原始数据。

从输出末尾提取 `AUDIT_RESULT` 值：
- `up_to_date`    → 执行 Step 2a
- `needs_update`  → 执行 Step 2b
- `minor_changes` → 执行 Step 2c

---

## Step 2a: 文档是最新的

```
✅ 文档无需更新，流程结束。
```

---

## Step 2b: 建议更新

询问用户：

```
⚠️ 检测到 feat/fix/refactor 类型改动，建议更新文档。

是否现在更新？
  · 回复 是 → 触发差量更新（保留人工内容）
  · 回复 否 → 保留现有文档，结束流程
```

**等待用户回复后再继续。**

---

## Step 2c: 改动轻微

询问用户：

```
💡 改动均为 chore/style/test 类型，通常不影响核心文档。

是否仍需更新？
  · 回复 是 → 触发差量更新
  · 回复 否 → 结束流程
```

**等待用户回复后再继续。**

---

## Step 3: 执行差量更新（用户回复"是"时）

**使用 Bash 工具**设置来源标记：

```bash
export UPDATE_FEATURE_ID="$AUDIT_FEATURE_ID"
export UPDATE_SOURCE="audit"
```

然后使用 **Read 工具**读取以下文件，并严格按照其中 Step 0 → Step 8 的所有步骤完整执行：

```
KIT_ROOT/.claude/commands/k/context-update.md
```

> ℹ️ `UPDATE_SOURCE=audit` 已设置，context-update Step 2 会自动读取 git commits，无需用户手动输入变更描述。

---

## Step 4: 用户拒绝更新

```
好的，保留现有文档不变。

如需稍后更新，可执行：
  /k/context audit <feature-id>
```

---

流程结束。
