---
description: 【已归档】从代码学习生成 Context 文档并完整入库（context v2.2 规范）
---

# Learn: 从代码生成 Context 文档（归档参考文件）

> ⚠️ **此文件已归档，不再作为运行时 prompt。**
> 完整工作流已内联至 `/commands/k/context-learn.md`。
> 本文件仅作为历史记录和对照参考保留。

---

将代码文件/目录分析为规范的 Context 文档，完整入库：reference 文档 + router JSON + context-index + 反向索引。

---

## Step 0: 环境准备与路径验证

```bash
source .cursor/kit/context/context-lib.sh
init_context_config

# 检查写权限（只在 soso-kit 主仓库执行）
if ! check_write_permission; then
    echo "❌ 只读模式：当前在 worktree 中，无法修改 context library"
    echo ""
    echo "💡 如需更新 context，请在 soso-kit 主仓库中执行："
    echo "   cd ~/Documents/code/soso-kit"
    echo "   /k/context learn <path>"
    exit 1
fi

# CODE_PATH 由 context.md 通过 $CODE_PATH 传入
if [ -z "$CODE_PATH" ]; then
    echo "❌ 缺少参数: 代码路径"
    echo "用法: /k/context learn <path>"
    exit 1
fi

if [ ! -e "$CODE_PATH" ]; then
    echo "❌ 路径不存在: $CODE_PATH"
    exit 1
fi

echo "📚 从代码生成 Context 文档"
echo "路径: $CODE_PATH"
echo ""
```

---

## Step 1: 扫描结构 + 全量读取代码

### 1a. 先用 outline 扫描文件骨架

在完整读取代码之前，先提取每个文件的符号骨架，了解文件结构、定位核心函数所在行。

对每个 `.ts` / `.tsx` 文件执行：

```bash
node .cursor/kit/context/tools/outline.js <file-path>
```

- **目录场景**：先用 `find <path> -type f \( -name "*.ts" -o -name "*.tsx" \)` 列出所有文件，再逐一 outline

outline 输出示例：
```
📁 src/hooks/useVaultDeposit.ts (180 行, ~720 tokens 如全量读取)

Exports:
  ƒ useVaultDeposit [exported]  L1-45   useVaultDeposit(depositAmount: BigNumber, chainId: number): VaultDepositState
  ƒ useBaseChainDeposit [exported]  L47-120  useBaseChainDeposit(params: BaseDepositParams): void
  ◇ VaultDepositState [exported]  L122-135
Internal:
  ƒ validateAmount  L142-155
  ƒ formatTxHash  L157-165
```

**将 outline 输出保存为 `$OUTLINE_MAP`**，供 Step 2 生成 `quickRef.coreLogic` 使用。

**同时累计 token 估算**，供 Step 9 填写精确的 `discovery_cost`：

```bash
FILE_TOKENS_TOTAL=0
# 在上方逐文件 outline 循环中，每次执行后追加：
# file_tokens=$(echo "$outline_out" | grep -oE '~[0-9]+ tokens' | grep -oE '[0-9]+' | head -1)
# [ -n "$file_tokens" ] && FILE_TOKENS_TOTAL=$((FILE_TOKENS_TOTAL + file_tokens))
```

### 1b. 全量读取代码

基于 outline 骨架，按以下优先级完整读取：

- **单文件**：直接 Read 整个文件
- **目录**：按以下优先级逐一完整 Read：
  - `use*.ts` / `use*.tsx`（hooks，最高优先级）
  - `index.tsx` / `index.ts`（入口文件）
  - 其他 `.tsx`（UI 组件）
  - `types.ts` / `*.type.ts`（类型定义）
  - 其他 `.ts`（工具/配置）

每个文件完整读取，不限行数。

---

## Step 2: 分析代码，生成结构化元数据

基于全量代码内容，生成以下结构化信息。**严格遵守命名规范**。

### ID 命名规范

```
格式：<module>-<feature>（无数字后缀）
示例：vault-deposit / network-switch / trade-transfer / stake-soso

规则：
  - 页面专属功能: <page>-<feature>（如 vault-deposit, trade-transfer）
  - 跨页共享基础设施: <feature>（如 network-switch）
  - 禁止数字后缀（不要 network-switch-01）
  - 全小写 kebab-case
```

### 有效模块列表（必须从以下选择）

```
vault    - Vault 充值提现功能
trade    - 主站交易功能（充值/提现/划转）
stake    - 质押相关功能
shared   - 跨模块共享基础设施（通用 Hook/工具/跨页功能）
core     - 核心基础 Hooks（全局依赖）
network  - 网络切换与多链支持
points   - 积分与奖励系统
```

### 生成目标结构（供后续步骤使用）

```json
{
  "featureId": "vault-deposit",
  "module": "vault",
  "title": "Vault Deposit 完整流程",
  "summary": "一句话概括功能，≤150字",
  "quickRef": {
    "coreLogic": [
      "函数名(参数类型): 返回类型  L起始-结束  一句话描述",
      "（共 3-5 条，直接从 Step 1 的 outline 输出提取，加上一句话描述）",
      "示例: useVaultDeposit(depositAmount: BigNumber, chainId: number): VaultDepositState  L1-45  主 Hook，管理充值状态机"
    ],
    "keyComponents": [
      "文件名.ts - 职责（一句话）",
      "（共 3-5 条）"
    ],
    "keyFiles": [
      "src/.../完整相对路径（不加项目名前缀）"
    ],
    "relatedConcepts": ["state-machine", "polling", "custom-hook"]
  },
  "sections": [
    {
      "title": "章节标题（对应文档中 ## 级标题）",
      "summary": "该章节内容一句话概括",
      "lineRange": [起始行, 结束行],
      "estimatedTokens": 500
    }
  ],
  "tags": ["state-machine", "bridge"]
}
```

**sections 说明**：lineRange 在 Step 4 写完文档后，对照实际行号填写，此处先按预估填写。

---

## Step 3: 用户确认

**首先检查 featureId 是否已存在**：

```bash
ROUTER_PATH=".cursor/kit/context/library/sodex-web/router/<module>.json"
if [ -f "$ROUTER_PATH" ] && grep -q "\"id\": \"<featureId>\"" "$ROUTER_PATH"; then
    echo "⚠️  featureId '<featureId>' 已存在于 router/<module>.json"
    echo "继续执行将覆盖现有文档和索引条目。"
    echo "如需更新已有 context，请使用 /k/context update <featureId>"
    echo ""
    echo "仍要继续？(y/N):"
fi
```

若用户选择 `N` 则终止流程，建议改用 `/k/context update`。

展示完整分析结果，**强制二次确认**，允许用户修改 ID 和模块后再继续：

```
📋 分析结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Feature ID  : <featureId>
  模块        : <module>
  标题        : <title>
  摘要        : <summary>
  关键文件    : <keyFiles 前3个，逗号分隔>
  标签        : <tags>
  文档路径    : reference/<module>/<featureId>-guide.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

修改 Feature ID? (直接回车跳过，当前: <featureId>):
修改模块? (vault/trade/stake/shared/core/network/points，直接回车跳过):
确认入库? (Y/n):
```

用户如输入新 Feature ID 或模块，更新对应变量后继续。
用户输入 `n` 则终止流程。

---

## Step 4: 写入 reference 文档

确认后，使用 **Write 工具**创建参考文档。

**路径**: `.cursor/kit/context/library/sodex-web/reference/<module>/<featureId>-guide.md`

**文档要求**：
- 基于实际代码内容撰写，不编造
- 参考 `reference/vault/vault-deposit-guide.md` 的详尽程度
- 使用 Markdown，`##` 级别分章节（sections 将基于此划分）

**文档结构模板**（按实际内容增减章节）：

```markdown
# <功能标题>

## 架构概览

（整体设计思路，流程图参考下方模板要求）

## 核心逻辑

（关键函数/状态机/数据流描述，带代码片段）

## 关键实现

（重要实现细节，含代码块，说明"为什么这样写"）

## 文件结构

（目录树，简述每个文件职责）

## 关键设计决策

（设计取舍，解释为什么不用其他方案）

## 开发修改指南

（可选：常见修改场景的步骤、边界条件、测试用例）

## 术语表

（如有项目特定概念，列出说明）

## 更新记录

### <YYYY-MM-DD>: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
```

### 流程图规范（必须遵守）

**必须参考模板**：`.cursor/kit/templates/history-flow-template.md`

| 场景 | 使用模板 | 说明 |
|------|----------|------|
| 用户操作触发数据/UI 变化 | 模版 a | 带箭头、状态框、分支判断 |
| 数据来源、依赖、过滤 | 模版 b | 多层数据流、Hook 依赖关系 |
| 从接口获取到 UI 显示 | 模版 c | 分步骤、带代码行号和代码片段 |

**格式要求**：
- ✅ 使用 ASCII 框图（`┌─┐ │ └─┘ ↓ →`）
- ✅ 必须标注代码文件和行号：`(fileName.ts Line X-Y)`
- ✅ 每步包含关键代码片段
- ❌ 不使用 Mermaid 流程图

写完文档后，立即执行以下命令获取**精确的 sections lineRange**：

```bash
DOC_FULL_PATH=".cursor/kit/context/library/sodex-web/reference/<module>/<featureId>-guide.md"

bash .cursor/kit/context/action/record/scripts/validate-sections.sh \
    --doc-path "$DOC_FULL_PATH" \
    --fix
```

此命令会自动扫描文档中所有 `##` 标题，输出带有精确 `lineRange` 和 `estimatedTokens` 的 JSON 数组。
将输出结果保存为 `$SECTIONS_FIX`，供 Step 5 使用（**直接用 lineRange 和 estimatedTokens，summary 替换为 Step 2 中生成的对应描述**）。

---

## Step 5: 更新 router/<module>.json

使用 **Edit 工具**，在 `features` 对象末尾新增功能条目。

**路径**: `.cursor/kit/context/library/sodex-web/router/<module>.json`

**新增内容**（sections 的 lineRange 和 estimatedTokens 来自 Step 4 的 `--fix` 输出，summary 来自 Step 2 分析）：

```json
"<featureId>": {
  "id": "<featureId>",
  "module": "<module>",
  "type": "feature",
  "title": "<title>",
  "summary": "<summary>",
  "discovery_cost": "<Step 1a 的 FILE_TOKENS_TOTAL + AI 分析估算，格式如 ~3200 tokens>",
  "quickRef": {
    "coreLogic": ["..."],
    "keyComponents": ["..."],
    "keyFiles": ["src/.../..."],
    "relatedConcepts": ["..."]
  },
  "referencePath": "reference/<module>/<featureId>-guide.md",
  "sections": [
    {
      "title": "章节标题",
      "summary": "Step 2 生成的对应章节概括",
      "lineRange": [Step4--fix输出的起始行, 结束行],
      "estimatedTokens": Step4--fix输出的token估算
    }
  ],
  "tags": ["tag1", "tag2"],
  "created": "<YYYY-MM-DD>",
  "updated": "<YYYY-MM-DD>"
}
```

若该模块的 router JSON 不存在，先创建文件，格式参考 `router/vault.json`。

**同时在 `history` 对象中追加初始记录**（若 history 对象不存在则创建）：

```json
"history": {
  "<featureId>": [
    {
      "date": "<YYYY-MM-DD>",
      "type": "feat",
      "summary": "初始版本，通过 /k/context learn 从代码自动生成",
      "files": ["quickRef.keyFiles 中的文件名（不含路径）"]
    }
  ]
}
```

---

## Step 6: 更新 context-index.json

使用 **Edit 工具**，修改以下三处：

**路径**: `.cursor/kit/context/library/sodex-web/context-index.json`

**1. 在对应 module 的 features 数组末尾追加**（找到 `"id": "<module>"` 的 module）：

```json
"features": ["已有id1", "已有id2", "<featureId>"]
```

> **新模块场景**：若 context-index.json 中尚无该 module 条目（全新模块），在 `modules` 数组末尾新增：
> ```json
> {
>   "id": "<module>",
>   "title": "<模块中文名>",
>   "description": "<一句话描述>",
>   "features": ["<featureId>"]
> }
> ```
> 同时更新 `meta.totalModules`（+1）。

**2. 在 recentQueue 数组头部插入**（不要追加末尾），**并保持队列不超过 10 条**（超出时删除末尾最旧条目）：

```json
{
  "id": "<featureId>",
  "module": "<module>",
  "date": "<YYYY-MM-DD>",
  "type": "feat",
  "summary": "<summary，≤80字>"
}
```

**3. 更新 meta**：

```json
"meta": {
  "totalFeatures": <原值 + 1>,
  "lastUpdated": "<YYYY-MM-DDT00:00:00Z>"
}
```

---

## Step 7: 更新反向索引

### files.json

**路径**: `.cursor/kit/context/library/sodex-web/indexes/files.json`

使用 **Edit 工具**，为 quickRef.keyFiles 中每个文件添加或追加条目：

- **文件不存在**：新增：
  ```json
  "<file-path>": {
    "features": ["<featureId>"],
    "lastUpdate": "<YYYY-MM-DD>"
  }
  ```
- **文件已存在**：在 `features` 数组中追加 `"<featureId>"`，更新 `lastUpdate`

同时更新 `meta.totalFiles`（仅新增文件路径时 +1）。

---

### tags.json

**路径**: `.cursor/kit/context/library/sodex-web/indexes/tags.json`

使用 **Edit 工具**，为 tags 中每个标签添加或追加条目：

- **tag 不存在**：新增 `"<tag>": ["<featureId>"]`
- **tag 已存在**：在数组中追加 `"<featureId>"`

同时更新 `meta.totalTags`（仅新增 tag 时 +1）和 `meta.lastUpdated`。

---

## Step 7b: 验证 JSON 结构

使用 python json.tool 验证所有修改的 JSON 文件格式正确：

```bash
echo "🔍 验证 JSON 结构..."

# 验证 router JSON
ROUTER_PATH=".cursor/kit/context/library/sodex-web/router/<module>.json"
cat "$ROUTER_PATH" | python3 -m json.tool > /dev/null && echo "✅ $ROUTER_PATH 格式正确" || echo "❌ $ROUTER_PATH 格式错误"

# 验证 context-index.json
INDEX_PATH=".cursor/kit/context/library/sodex-web/context-index.json"
cat "$INDEX_PATH" | python3 -m json.tool > /dev/null && echo "✅ $INDEX_PATH 格式正确" || echo "❌ $INDEX_PATH 格式错误"

# 验证 files.json
FILES_INDEX=".cursor/kit/context/library/sodex-web/indexes/files.json"
cat "$FILES_INDEX" | python3 -m json.tool > /dev/null && echo "✅ $FILES_INDEX 格式正确" || echo "❌ $FILES_INDEX 格式错误"

# 验证 tags.json
TAGS_INDEX=".cursor/kit/context/library/sodex-web/indexes/tags.json"
cat "$TAGS_INDEX" | python3 -m json.tool > /dev/null && echo "✅ $TAGS_INDEX 格式正确" || echo "❌ $TAGS_INDEX 格式错误"
```

若任何文件验证失败，**立即修复 JSON 语法错误**后继续。

---

## Step 8: 文档质量自检

以开发者视角审查刚生成的文档，模拟"第一次使用这份 context"：

### 检查维度

**A. 架构可理解性**
- [ ] `## 架构概览` 是否能在不看源码的情况下理解整体设计？
- [ ] 对于复杂流程（状态机、多步骤流程），是否有 ASCII 图或流程描述？

**B. 代码可定位性**
- [ ] `quickRef.keyFiles` 是否包含了所有核心文件（hooks、入口、类型）？
- [ ] `quickRef.coreLogic` 是否包含完整签名（参数类型 + 返回类型 + 行号），而不只是函数名？

**C. 关键逻辑清晰度**
- [ ] `## 核心逻辑` 是否有代码片段（非伪代码）佐证？
- [ ] `## 关键设计决策` 是否解释了"为什么这样写，而不是其他方案"？

**D. 信息完整性**
- [ ] 是否有核心 Hook / 关键 API 调用 / 状态转换未被文档覆盖？
- [ ] `tags` 是否反映了主要技术模式（如 state-machine、polling、optimistic-update）？

### 输出自检报告

```
🔍 文档自检报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  A. 架构可理解性  : ✅/⚠️/❌  [一句说明]
  B. 代码可定位性  : ✅/⚠️/❌  [一句说明]
  C. 关键逻辑清晰度: ✅/⚠️/❌  [一句说明]
  D. 信息完整性    : ✅/⚠️/❌  [一句说明]

结论: [整体评估：文档质量良好 / 存在以下问题需补充]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

若发现 ⚠️ 或 ❌，**立即补救**（使用 Edit 工具修改 reference 文档或 router JSON），补救后在报告中标注 `→ 已修正`。

---

## Step 9: 完成输出

输出 token 成本报告，并填写精确的 `discovery_cost`：

```
✅ 入库完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Feature ID : <featureId>
  模块       : <module>
  文档       : reference/<module>/<featureId>-guide.md
  标签       : <tags>

📊 Token 成本
  outline 扫描   : ~0 tokens（零消耗，shell 脚本）
  keyFiles 全量读取估算 : ~<FILE_TOKENS_TOTAL> tokens
  AI 分析与写作  : ~<实际消耗，估算>
  ───────────────────────────────
  本次总计       : ~<三项合计> tokens
  discovery_cost : 已写入 router JSON

验证：
  /k/context load <featureId>
  /k/context search <keyword>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> `discovery_cost` = keyFiles 全量读取估算 + AI 分析估算（用于评估"未来加载该功能的记忆价值权重"）。

---

入库流程结束。
