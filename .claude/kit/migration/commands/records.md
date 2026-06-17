# Migration Records: 跨迁移方法论坑管理

## 输入

```text
$ARGUMENTS
```

第一个词是子命令（不传默认 `list`）。

| SUBCOMMAND | 动作 |
|---|---|
| `list` / `ls` | 展示 `records/index.md` |
| `load` / `l <id>` | 读取指定分类详情 |
| `add` / `a` | 引导新增一条 record |
| `update` / `u <id>` | 更新已有 |
| `remove` / `rm <id>` | 删除 |

---

## 前置

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RECORDS_DIR="$KIT_ROOT/.claude/kit/migration/records"
INDEX_FILE="$RECORDS_DIR/index.md"
```

---

## 执行

### list / ls

```bash
cat "$INDEX_FILE"
```

### load `<id>`

1. 从 `$INDEX_FILE` 的表格中找 `<id>` 对应的分类文件名
   ```bash
   CATEGORY=$(awk -F'|' -v id="$id" '$0 ~ id {print $3}' "$INDEX_FILE" | tr -d ' ')
   ```
2. 输出该分类文件的完整内容
   ```bash
   cat "$RECORDS_DIR/$CATEGORY"
   ```
   同时定位到 `## <id>` 小节供 AI 聚焦

### add

引导用户填写字段（**严格分步，每步等用户回复**）：

1. `id`（格式：`<category>:<slug>`，如 `api-contract:baseURL-naming`）
2. `tags`（逗号分隔）
3. `severity`（low / medium / high）
4. **分类归属**：
   - 新 id 的 `category` 前缀和现有分类文件匹配吗？
   - 匹配 → 追加到该文件末尾（新 `## <id>` 小节）
   - 不匹配 → 新建 `records/<category>.md`，文件头格式参考现有分类
5. **触发场景** / **典型症状** / **根因** / **避坑动作** / **检测建议** / **本次来源** 按模板填写
6. 用 Write 追加 / 新建分类 md
7. Edit `index.md` 在表格里新增一行

**保存后输出**：

```
✅ record 新增成功
  id: <id>
  文件: records/<category>.md
  index: 已更新
```

### update `<id>`

1. 先 `load <id>` 展示当前内容
2. 询问：修改哪些字段？（触发场景 / 症状 / 根因 / 避坑动作 / 来源等）
3. Edit 更新对应段落；若 `tags` / `severity` / 一句话避坑有变，同步 Edit `index.md` 表格行

### remove `<id>`

1. `load <id>` 展示供用户确认
2. 询问：`确认删除 <id>？回复 Y 继续`，**等待用户回复**
3. 用户确认：
   - Edit 对应分类 md，删除该 `## <id>` 段（保留其他条目）
   - 若该分类 md 只剩分类标题无条目 → 直接删除整个文件
   - Edit `index.md`，删除表格中该行

---

## Harvest 模式（由 finalize 调用，不是用户直接调用）

`records harvest` 读 verify 产出的 `migration-records-candidates.md`，对每条展示：

```
候选 #N: <问题摘要>
  推荐: records add | pitfall add | history only | skip
  理由: <一句话>
  操作: [a]dd / [p]itfall / [h]istory / [s]kip / [e]dit
```

逐条等用户输入 → 只对 `a` / `p` 触发写入流程，其余跳过。

---

## 设计说明

- **纯 markdown**：无 index.json，依赖 `index.md` 维护条目-分类映射
- **一类一文件**：多条 record 可共享同一分类 md（`## <id>` 分段）
- **按需加载**：`list` 只读 index.md；`load` 才读分类详情
- **与 pitfall 独立**：records 是 kit 级（跨项目通用），pitfall 是项目级
