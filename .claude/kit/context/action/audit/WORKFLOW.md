---
description: 检测单个 context 文档是否需要更新（基于 git 历史，零 token 检测）
---

# Audit: 检测 Context 文档时效性

通过 git 历史检测指定 context 的关键文件是否有改动，判断文档是否需要更新。

**Token 策略**：
- 检测阶段：shell 脚本执行，零 token
- 确认阶段：AI 展示结果 + 询问用户，极少 token
- 更新阶段：仅当用户确认时，触发 `update` WORKFLOW（差量更新）

---

## Step 0: 参数验证

```bash
if [ -z "$AUDIT_FEATURE_ID" ]; then
    echo "❌ 缺少参数: feature-id"
    echo "用法: /k/context audit <feature-id>"
    exit 1
fi

echo "🔍 准备审计 context: $AUDIT_FEATURE_ID"
echo ""
```

---

## Step 1: 运行 git 历史检测（零 token）

**使用 Bash 工具执行以下命令**：

```bash
bash "$KIT_ROOT/.cursor/kit/context/action/audit/scripts/check-git-history.sh" \
    "$AUDIT_FEATURE_ID"
```

将脚本完整输出展示给用户，**不做任何 AI 分析**，仅呈现原始数据。

从输出中提取最后几行的 `AUDIT_RESULT` 值：
- `up_to_date`    → 执行 Step 2a
- `needs_update`  → 执行 Step 2b
- `minor_changes` → 执行 Step 2c

---

## Step 2a: 文档是最新的

直接告知用户：

```
✅ 文档无需更新，流程结束。
```

---

## Step 2b: 建议更新

询问用户（在对话中，不在 bash 脚本中）：

```
⚠️ 检测到 feat/fix/refactor 类型改动，建议更新文档。

是否现在更新？
  · 回复 是 → 触发差量更新（update WORKFLOW，保留人工内容）
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

设置环境变量，将来源标记为 `audit`：

```bash
export UPDATE_FEATURE_ID="$AUDIT_FEATURE_ID"
export UPDATE_SOURCE="audit"
```

然后使用 **Read 工具**读取以下文件，并严格按照其中 Step 0 → Step 8 的所有步骤完整执行：

```
KIT_ROOT/.cursor/commands/k/context-update.md
```

> ℹ️ `context-update.md` 是自包含的完整 update 工作流（含执行契约、token 优化、Step 8 checkpoint）。
> `UPDATE_SOURCE=audit` 已设置，Step 2 会自动走"来源 A"读取 git commits，无需用户手动输入变更描述。

---

## Step 4: 用户拒绝更新

回复：

```
好的，保留现有文档不变。

如需稍后更新，可执行：
  /k/context audit <feature-id>
```

---

流程结束。
