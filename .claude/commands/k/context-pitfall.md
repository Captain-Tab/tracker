---
description: Pitfall 查询与记录：list/load/add/update/remove
---

# Pitfalls: 已知问题库

## 用户输入

```text
$ARGUMENTS
```

---

## 执行步骤

### Step 1: 解析子命令

- `SUBCOMMAND` = 第一个词（空则默认 `list`）
- `PARAMS` = 其余部分

| SUBCOMMAND | 动作 |
|---|---|
| `list` / `ls` | 列出所有 pitfall（含 token 估算） |
| `load` / `l` | 读取指定条目完整内容 |
| `add` / `a` | 引导新增一条 pitfall |
| `update` / `u` | 更新已有 pitfall 内容 |
| `remove` / `rm` | 删除指定 pitfall |

---

### Step 2: 定位 pitfalls 目录

```bash
dir=$(pwd); KIT_ROOT=""
for i in 1 2 3 4 5; do
  [ -d "$dir/.claude/kit/context" ] && KIT_ROOT="$dir" && break
  dir="$(dirname "$dir")"
done

source "$KIT_ROOT/.claude/kit/context/context-lib.sh" && init_context_config
PITFALL_DIR="$CONTEXT_PROJECT_DIR/pitfalls"
```

---

### Step 3: 执行

**list**：运行查询脚本，展示完整输出。
```bash
bash "$KIT_ROOT/.claude/kit/context/query/query-pitfall.sh"
```

**load `<id>`**：运行查询脚本加载完整内容（含 token 统计）。
```bash
bash "$KIT_ROOT/.claude/kit/context/query/query-pitfall.sh" --id "<id>"
```

**add**：
1. 使用 Read 工具读取 `$KIT_ROOT/.claude/kit/context/action/pitfall/template.md`
2. 引导用户填写各字段（id、tags、related_feature、severity、date、各段内容）
3. **Gate 分类引导**（必须询问）：
   ```
   🔒 门检查分类：这个问题是否满足以下任一条件？
   - 涉及项目通用模式（MobX store、calculate 精度、签名流程...）
   - 不限于特定功能，其他功能也可能犯同样错误
   - 根因是"忘了做某个固定步骤"
   
   → 是：gate: true，请提供一句话检查规则（gate_rule）
        追问：哪些关键词出现在需求描述中时应触发这条检查？（trigger，逗号分隔）
        示例：trigger: [store, mobx, observable]
   → 否：gate: false（纯记录）
   ```
4. 用 Write 工具写入 `$PITFALL_DIR/<id>.md`
5. 运行脚本同步索引（脚本负责 index.json + index.md，避免 AI 手动编辑 JSON）：
   ```bash
   bash "$KIT_ROOT/.claude/kit/context/action/pitfall/scripts/add-to-index.sh" \
     "<id>" "<tag1,tag2>" "<标题>" "<一句话描述>" "<related_feature>" "<severity>" "<date>" "<gate>" "<gate_rule>" "<trigger_csv>"
   ```

**update `<id>`**：
1. 运行 `query-pitfall.sh --id <id>` 展示当前内容
2. 询问用户要修改哪些内容
3. 用 Edit 工具修改 `$PITFALL_DIR/<id>.md`
4. 运行脚本同步索引（自动重算 estimatedTokens）：
   ```bash
   # 如有元数据变更，通过环境变量传入（不变的字段不传）
   UPDATE_TAGS_CSV="<新tags>" UPDATE_SUMMARY="<新summary>" \
   bash "$KIT_ROOT/.claude/kit/context/action/pitfall/scripts/update-index-entry.sh" "<id>"
   ```

**remove `<id>`**：
1. 运行查询脚本展示条目信息，让用户确认：
   ```bash
   bash "$KIT_ROOT/.claude/kit/context/query/query-pitfall.sh" --id "<id>"
   ```
2. 询问用户：「确认删除 `<id>`？回复 Y 继续」，**等待用户回复**
3. 用户确认后，运行脚本执行删除（文件 + index.json + index.md 一并清理）：
   ```bash
   bash "$KIT_ROOT/.claude/kit/context/action/pitfall/scripts/remove-from-index.sh" "<id>"
   ```

---

## 使用示例

```
/k/context-pitfall                           # 查看索引（含 token 估算）
/k/context-pitfall list                      # 同上
/k/context-pitfall load trade-feerate-mobx   # 加载具体条目
/k/context-pitfall add                       # 新增一条
/k/context-pitfall update trade-feerate-mobx # 更新已有条目
/k/context-pitfall remove trade-feerate-mobx # 删除条目
```
