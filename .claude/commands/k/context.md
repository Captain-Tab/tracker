---
description: 上下文查询：list/search/load/files/tag/recent/outline/unfold。写入命令请用 /k/context-record /k/context-learn /k/context-update /k/context-audit /k/context-remove /k/context-init
---

# 上下文查询: Context

## 用户输入

```text
$ARGUMENTS
```

---

## Few-shot 示例

**输入**: `load trade-deposit`

**AI 执行**：使用 Bash 工具（单次调用）：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && cd "$KIT_ROOT" && source .claude/kit/context/context-lib.sh && context_load "trade-deposit" && init_context_config && FEAT="trade-deposit" && MODULE=$(jq -r ".modules[] | select(.features[] == \"$FEAT\") | .id" "$CONTEXT_INDEX_FILE") && TOK=$(jq --arg f "$FEAT" '[.features[$f].sections[].estimatedTokens] | add // 0' "$CONTEXT_PROJECT_DIR/router/$MODULE.json") && echo "📊 文档约 ~$TOK tokens 已加载"
```

展示完整输出，结束。

---

## 执行步骤

### Step 1: 解析 $ARGUMENTS

- `SUBCOMMAND` = 第一个词（空则默认 `list`）
- `PARAMS` = 其余部分（可为空）

### Step 2: 函数映射

| SUBCOMMAND | 调用函数 |
|---|---|
| `list` / `ls` | `context_list` |
| `search` / `s` | `context_search "$PARAMS"` |
| `load` / `l` | `context_load "$PARAMS"` |
| `files` / `f` | `context_query_file "$PARAMS"` |
| `tag` | `context_query_tag "$PARAMS"` |
| `outline` / `o` | `context_outline "$PARAMS"` |
| `unfold` / `u` | `context_unfold $PARAMS` |
| `recent` / `r` | `context_recent` |
| `rebuild-indexes` / `rebuild` | `context_rebuild_indexes $PARAMS` |
| `help` / `h` | `context_help` |

### Step 3: 使用 Bash 工具执行（单次调用）

将 `<FN>` 替换为上表对应的函数调用后执行：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && cd "$KIT_ROOT" && source .claude/kit/context/context-lib.sh && <FN>
```

展示 Bash 工具的完整输出。

### Step 4: Token 显示（仅 load 命令）

**只有 `load` 需要显示 token**——它加载的是完整 reference 文档，可能较大，值得告知用户。其他命令（list/search/files/tag/recent/outline）返回的是轻量索引元数据，无需显示。

> 💡 **Token 优化建议**:优先用 `outline` 看目录结构,只在确实需要细节时才 `load`/`unfold`。不要无差别 `load` 大 feature 包。

`load` 命令将 token 查询和 pitfall 检查**合并进 Step 3 的同一条 bash 命令**，无需额外调用：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && cd "$KIT_ROOT" && source .claude/kit/context/context-lib.sh && context_load "<PARAMS>" && init_context_config && FEAT="<PARAMS>" && MODULE=$(jq -r ".modules[] | select(.features[] == \"$FEAT\") | .id" "$CONTEXT_INDEX_FILE") && TOK=$(jq --arg f "$FEAT" '[.features[$f].sections[].estimatedTokens] | add // 0' "$CONTEXT_PROJECT_DIR/router/$MODULE.json") && echo "📊 文档约 ~$TOK tokens 已加载" && bash "$KIT_ROOT/.claude/kit/context/query/check-feature-pitfalls.sh" "<PARAMS>"
```

---

## 写入命令提示

当 SUBCOMMAND 为以下时，**不执行**，直接提示用户使用对应命令：

| SUBCOMMAND | 提示 |
|---|---|
| `record` | 请使用 `/k/context-record` |
| `learn` | 请使用 `/k/context-learn <path>` |
| `update` | 请使用 `/k/context-update <feature-id>` |
| `audit` | 请使用 `/k/context-audit <feature-id>` |
| `remove` / `rm` | 请使用 `/k/context-remove <feature-id>` |
| `init` | 请使用 `/k/context-init <path-or-name>` |
