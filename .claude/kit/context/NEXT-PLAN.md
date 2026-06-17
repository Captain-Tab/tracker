# Context 系统下一步改进计划

> 来源：2026-04-15 讨论，结合 claude-mem 对比分析和 CRUD 全链路评估。
> 筛选原则：对单人使用者有实际价值、零外部依赖、投入产出比高。

---

## P0：立刻做（改动小、收益确定）

### 1. 修复 context_files()

**问题**：`context-lib.sh:590-604` 的 `context_files()` 引用 `$CONTEXT_INDEX_FILE` 的 `.indexes.byFiles`，该字段不存在。实际数据在 `indexes/files.json`。同时 `context_query_file()` 调用外部脚本 `query-file.sh`，两个函数做同一件事但都不完整。

**改动**：删掉 `context_files()`，让 `context_query_file()` 直接读 `indexes/files.json`。

**工作量**：~10 行。

**收益**：文件→feature 查询恢复工作，这是 AI 自动关联 context 的基础。

### 2. keyFiles basename 加入搜索域

**问题**：搜 "useVaultDeposit" 不一定命中，因为搜索域不包含 `quickRef.keyFiles` 里的文件名。

**改动**：`context_search()` 中把 keyFiles 的 basename（去掉路径和扩展名）拼入 `search_text`。

**工作量**：~3 行。

**收益**：函数名/文件名搜索直接命中对应 feature。

### 3. heading-based 动态提取

**问题**：`load --section` 用静态 `lineRange` 提取内容，文档编辑后行号漂移 → 提取到错误内容，用户无感知。

**改动**：`context_load()` 的 section 模式中，用 `grep -n "^## {section_title}"` 动态定位标题位置，替代 `sed -n "${start},${end}p"`。保留 lineRange 作为 fallback（标题被改时降级）。

**工作量**：~20 行。

**收益**：`--section` 从"可能读错"变成"一定读对"，无论文档怎么编辑。

---

## P1：近期做（收益明确、需要适量工作）

### 4. 文档模板统一化

**问题**：每个 feature 文档章节结构不同，AI 必须先读 L2 索引才能判断要读哪个 section。

**改动**：定义固定 6-section 模板，所有 feature 文档统一结构：

```markdown
## 1. 概述        ← 是什么、解决什么问题
## 2. 架构        ← 模块关系、数据流
## 3. 核心逻辑    ← 关键函数签名 + 调用链（3-5 个）
## 4. 状态管理    ← 状态机/store/生命周期
## 5. 文件清单    ← 文件 + 职责表格
## 6. 边界与约束  ← 已知限制、易错点、pitfall
```

编号固定 → AI 直接 `--section 3` 不需要先看索引。

**工作量**：
- 确定模板内容（讨论确认）
- 迁移现有 35 个文档（可脚本批量处理）
- 修改 learn/record 的 prompt，让生成的文档遵循模板

**收益**：

| 操作 | 当前 | 模板化后 |
|------|------|---------|
| record | 需要 analyze-document.sh + summary 生成 | 删掉这两步 |
| update | 需要 diff 分析 + lineRange 重算 + summary 重写 | 直接改对应 section |
| load section | L2 索引 300t + section 500t = 800t | 直接 500t（跳过 L2） |
| AI 不确定时 | load full 5000t | 编号固定，能判断 → 500t |

router.json 的 `sections` 数组大幅简化（标题固定、lineRange 不需要、summary 不需要）。

### 5. 触发词表 triggers

**问题**：搜索 "充值" 匹配不到 "deposit"，搜索 "余额" 匹配不到 "balance"。tags 只有 3-5 个英文技术概念，覆盖面太窄。

**改动**：每个 feature 在 router.json 中新增 `triggers` 字段：

```json
{
  "vault-deposit": {
    "tags": ["vault", "deposit", "state-machine"],
    "triggers": [
      "充值", "deposit", "vault充值", "跨链", "bridge",
      "settling", "useVaultDeposit", "useBaseChainDeposit",
      "Base Chain", "Value Chain", "充钱", "入金"
    ]
  }
}
```

`context_search()` 搜索域加入 triggers。

**工作量**：搜索改动 ~5 行 + 为 35 个 feature 补充 triggers 数据。

**收益**：中文搜英文、业务术语搜技术文档、函数名搜 feature 全部命中。

### 6. flatIndex 消除 list/search 的 12 次 I/O

**问题**：`list` 和 `search` 每次加载全部 12 个 router/*.json 文件（12 次文件读取 + 35 次 jq 调用）。

**改动**：context-index.json 中嵌入 flatIndex：

```json
{
  "flatIndex": {
    "vault-deposit": {
      "module": "vault",
      "title": "Vault Deposit 完整流程",
      "summary": "Base Chain + Value Chain 双层...",
      "tags": ["vault", "deposit", "state-machine"]
    }
  }
}
```

`context_list()` 和 `context_search()` 从 flatIndex 读取，不再加载 router 文件。

**工作量**：~30 行改动 + record/update/remove 时同步 flatIndex。

**收益**：list/search 从 12 次 I/O → 1 次。context-index.json 增加 ~4KB，仍然轻量。

### 7. AI 自动关联 context 的 rule

**问题**：AI 修改文件时不会自动查 context，依赖用户手动 load。

**改动**：新建 `.claude/rules/context-auto-load.md`：

```markdown
当你即将修改某个文件时，先执行 /k/context file <文件路径>
查看该文件关联的 feature，如有关联则 load 对应 section 3（核心逻辑）和 section 6（边界与约束）。
```

同时在 `/k/task`、`/k/plan` 的 prompt 中增加 Step 0：对 spec 涉及的核心文件查询 context。

**工作量**：1 个 rule 文件 + 改几行 skill prompt。

**收益**：从"人记得去查"变成"规则驱动自动查"。依赖 P0-1（context_files 修复）。

---

## P2：规划中（收益有但非紧急）

### 8. BM25 搜索引擎

**问题**：grep 统计精确子串出现次数，无词频饱和、文档长度归一化、逆文档频率。

**改动**：纯 JS 实现 BM25（~80 行），record/update 时预算词频表存入 `indexes/bm25.json`，search 时内存计算。

**前置条件**：如果 P1-5（triggers）做了，搜索命中率已大幅提升，BM25 的增量价值降低。

**工作量**：~80 行 JS + 搜索入口改动。

**收益**：多关键词天然支持、IDF 自动加权、短文档优先。在 triggers + keyFiles basename 之上的增量提升。

### 9. 同义词映射表 synonyms.json

**问题**：triggers 是 per-feature 的，同一个同义词要在每个相关 feature 重复写。

**改动**：全局 `indexes/synonyms.json`，搜索时自动展开查询词。

```json
{
  "充值": ["deposit", "充钱", "入金"],
  "提现": ["withdraw", "出金", "提币"],
  "手续费": ["fee", "feerate", "费率"]
}
```

**前置条件**：P1-5（triggers）做完后评估是否还需要。

**工作量**：新建文件 + 搜索展开逻辑 ~20 行。

**收益**：全局中英文互搜，维护成本低于逐 feature 补 triggers。

---

## 明确不做的方案

| 方案 | 不做的原因 |
|------|-----------|
| ChromaDB / 向量数据库 | 35 个 feature 用不上，引入重依赖（Python + embedding 模型） |
| AST 依赖图 | 实现成本高，需要跨仓库访问 sodex-web 代码，outline.js 需大改 |
| Worker 守护进程 | 单人使用不需要后台服务 |
| PostToolUse 自动观察 | 单人用户知识传递不是痛点，现有流程已覆盖 |
| UserPromptSubmit 自动注入 | 每次 prompt 消耗 ~800t 做索引匹配，大部分浪费 |
| MCP Server 封装 | 工作量大，rule 驱动已够用 |
| 文档拆分为多文件 | 模板化后不需要拆分，单文件 + heading-based 已解决问题 |
| SQLite 替换 JSON | 35 个 feature 规模下 JSON 完全够用 |

---

## 依赖关系

```
P0-1 修复 context_files ──→ P1-7 AI 自动关联 rule（依赖文件查询能力）
P0-3 heading-based ────────→ P1-4 文档模板化（模板化后 heading-based 更精准）
P1-4 文档模板化 ──────────→ P1-5 triggers（record 时同步生成 triggers）
P1-5 triggers ─────────────→ P2-8 BM25（评估 triggers 后 BM25 的增量价值）
P1-5 triggers ─────────────→ P2-9 synonyms（评估 triggers 后是否还需全局同义词）
```

## 执行顺序建议

```
第一批：P0-1 + P0-2 + P0-3（3 个快速修复，~30 行总改动）
第二批：P1-4（模板讨论确认 + 迁移）
第三批：P1-5 + P1-6 + P1-7（搜索增强 + AI 自动关联）
后续：根据实际使用评估 P2
```
