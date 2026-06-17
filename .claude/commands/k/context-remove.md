---
description: 删除 Context 功能及其关联文档（慎用）
---

# Context Remove

## 用户输入（Feature ID）

```text
$ARGUMENTS
```

---

## Step 0: 初始化

`FEATURE_ID` = `$ARGUMENTS`

使用 **Bash 工具**找到 KIT_ROOT（向上查找包含 `.claude/kit/context/library` 的目录）：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && echo "KIT_ROOT=$KIT_ROOT"
```

若 KIT_ROOT 为空，输出 `❌ 未找到 context library，请确认 .cursor 目录已同步` 后结束。

---

## Step 1: 展示功能信息（防止误删）

使用 **Bash 工具**读取功能信息并展示（将 `KIT_ROOT` 和 `FEATURE_ID` 替换为实际值）：

```bash
cd "KIT_ROOT" && source .claude/kit/context/context-lib.sh && init_context_config && MODULE=$(jq -r '.modules[] | select(.features[] == "FEATURE_ID") | .id' "$CONTEXT_INDEX_FILE") && jq -r ".features[\"FEATURE_ID\"] | {title, summary, tags, updated}" "$CONTEXT_PROJECT_DIR/router/${MODULE}.json"
```

---

## Step 2: 用户确认

在**对话中**询问用户：

```
⚠️ 即将删除功能: FEATURE_ID
   以上为功能信息，删除后文档将移至 .archive/，无法直接恢复。

确认删除？请回复 是 / 否
```

**等待用户回复后再继续。**

---

## Step 3: 执行删除（用户回复"是"后）

使用 **Bash 工具**执行（将 `KIT_ROOT` 和 `FEATURE_ID` 替换为实际值）：

```bash
echo "yes" | KIT_ROOT="KIT_ROOT" bash "KIT_ROOT/.claude/kit/context/action/remove/scripts/remove-feature.sh" "FEATURE_ID"
```

展示完整输出。

---

## Step 4: 用户拒绝

若用户回复"否"，输出：`已取消，功能保留不变。`
