---
description: 从代码逆向生成 Context 文档并入库
---

# Context Learn

## 用户输入（代码路径）

```text
$ARGUMENTS
```

---

## Step 0: 初始化

`CODE_PATH` = `$ARGUMENTS`

**使用 Bash 工具**找到 KIT_ROOT：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && echo "KIT_ROOT=$KIT_ROOT"
```

若 KIT_ROOT 为空，输出 `❌ 未找到 context library，请确认 .cursor 目录已同步` 后结束。

**使用 Bash 工具**校验权限：

```bash
source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

if ! check_write_permission; then
    echo "❌ 只读模式：请在 soso-kit 主仓库中执行"
    exit 1
fi

if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi

if [ -z "$CODE_PATH" ] || [ ! -e "$CODE_PATH" ]; then
    echo "❌ 路径不存在: $CODE_PATH"
    exit 1
fi

echo "📚 从代码生成 Context 文档"
echo "路径: $CODE_PATH"
```

---

## ⚠️ 执行契约（开始前确认）

本命令必须完成以下全部操作，**缺一不可**：

- [ ] Step 4: 写入 reference 文档（含内嵌质量自检）
- [ ] Step 5: 更新 router JSON（新增功能条目 + history）
- [ ] Step 6: 更新 context-index.json
- [ ] Step 7: 更新反向索引（files.json + tags.json）
- [ ] Step 7b: 验证所有 JSON 结构
- [ ] Step 9: 输出完成报告

在输出 Step 9 之前，必须逐项确认以上步骤均已执行。

---

## Step 1: 扫描结构 + 全量读取代码

### 1a. Outline 扫描（零 AI token）

对 `CODE_PATH` 下每个 `.ts` / `.tsx` 文件，**使用 Bash 工具**执行：

```bash
# 单文件
bash "$KIT_ROOT/.claude/kit/context/tools/outline.sh" "$CODE_PATH" "$(dirname $CODE_PATH)"

# 目录：先列出所有文件
find "$CODE_PATH" -type f \( -name "*.ts" -o -name "*.tsx" \) | sort
# 再逐一 outline（每个文件单独执行 Bash）
```

将所有 outline 输出保存为 `$OUTLINE_MAP`，累计 `FILE_TOKENS_TOTAL`（从每个文件 outline 的 `~X tokens` 提取）。

### 1b. 全量读取代码

基于 outline 骨架，按优先级用 **Read 工具**完整读取每个文件：

1. `use*.ts` / `use*.tsx`（hooks，最高优先级）
2. `index.tsx` / `index.ts`（入口文件）
3. 其他 `.tsx`（UI 组件）
4. `types.ts` / `*.type.ts`（类型定义）
5. 其他 `.ts`（工具/配置）

每个文件完整读取，不限行数。

读取完成后，按以下格式记录每个文件的 token 消耗（以 outline 的 `~X tokens` 为准），累计为 `ACTUAL_READ_TOKENS`：

```
已读取：
  use*.ts       ~<N> tokens
  index.tsx     ~<N> tokens
  types.ts      ~<N> tokens
  ...
ACTUAL_READ_TOKENS = ~<合计> tokens
```

### 1c. 跨目录关联扫描（零 AI token）

从已读代码中提取 MobX store 名称（如 `useStore()` 解构出的 `stepRate`、`spotAsset` 等），用 **Grep 工具**在 `src/` 全局搜索引用了同一 store 的文件：

```
Grep: pattern="<storeName>" path="src/" output_mode="files_with_matches"
```

过滤规则：
- 排除 CODE_PATH 下已扫描的文件
- 排除 `models/index.ts`（store 注册文件）
- 排除 `__deprecated_*` 文件
- 排除样式文件（`.scss`/`.css`/`.module.*`）

对剩余文件逐一判断是否与当前功能强相关（如入口组件、网关组件、路由注册）。若发现关联文件：
- 用 **Read 工具**读取并补充到分析上下文
- 在 Step 3 确认时标注为「跨目录关联文件」
- 根据关联强度决定是否纳入 keyFiles（仅作为其他模块子组件的标注在文档中提及即可，不必纳入 keyFiles）

> 此步骤仅执行 grep + 判断，不消耗 AI token（grep 为工具调用）。典型增量：0-3 个文件，~200-500 tokens 读取成本。

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

### 生成目标结构

```json
{
  "featureId": "vault-deposit",
  "module": "vault",
  "title": "Vault Deposit 完整流程",
  "summary": "一句话概括功能，≤150字",
  "quickRef": {
    "coreLogic": [
      "函数名(参数类型): 返回类型  L起始-结束  一句话描述",
      "（共 3-5 条，直接从 Step 1 的 outline 输出提取，加上一句话描述）"
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

> sections 的 lineRange 在 Step 4 写完文档后，通过 validate-sections.sh 获取精确值。

> **输出约束**：直接输出填写好的 JSON 结构，不在 JSON 之前重复解释分析过程。推理在内部完成，只输出结论性结构。

---

## Step 3: 用户确认

**使用 Bash 工具**检查 featureId 是否已存在：

```bash
ROUTER_PATH="$CONTEXT_PROJECT_DIR/router/<module>.json"
if [ -f "$ROUTER_PATH" ]; then
    EXISTS=$(jq -r ".features[\"<featureId>\"] // null" "$ROUTER_PATH")
    if [ "$EXISTS" != "null" ]; then
        echo "⚠️  featureId '<featureId>' 已存在"
        echo "如需更新已有 context，请使用 /k/context-update <featureId>"
        echo "仍要继续覆盖？(y/N):"
    fi
fi
```

展示完整分析结果，**强制二次确认**：

```
📋 分析结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Feature ID  : <featureId>
  模块        : <module>
  标题        : <title>
  摘要        : <summary>
  关键文件    : <keyFiles 前3个>
  标签        : <tags>
  文档路径    : reference/<module>/<featureId>-guide.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

修改 Feature ID? (直接回车跳过):
修改模块? (直接回车跳过):
确认入库? (Y/n):
```

用户输入 `n` 则终止流程。

---

## Step 4: 写入 reference 文档

确认后，使用 **Write 工具**创建参考文档。

**路径**: `$CONTEXT_PROJECT_DIR/reference/<module>/<featureId>-guide.md`

**文档结构模板**（按实际内容增减章节）：

```markdown
# <功能标题>

## 架构概览
## 核心逻辑
## 关键实现
## 文件结构
## 关键设计决策
## 开发修改指南
## 术语表
## 更新记录

### <YYYY-MM-DD>: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
```

**流程图规范**（必须遵守）：

| 场景 | 使用模板 |
|------|----------|
| 用户操作触发数据/UI 变化 | 模版 a |
| 数据来源、依赖、过滤 | 模版 b |
| 从接口获取到 UI 显示 | 模版 c |

- ✅ 使用 ASCII 框图（`┌─┐ │ └─┘ ↓ →`），标注文件和行号
- ✅ 每步包含关键代码片段
- ❌ 不使用 Mermaid

**写作时同步满足以下质量标准（无需另开 Step 8）**：

| 维度 | 标准 |
|------|------|
| A. 架构可理解性 | `## 架构概览` 含 ASCII 图，不看源码能理解整体设计 |
| B. 代码可定位性 | `coreLogic` 含完整签名 + `L起-止` 行号，`keyFiles` 覆盖全部核心文件 |
| C. 关键逻辑清晰度 | `## 核心逻辑` 含真实代码片段，解释设计决策的"为什么" |
| D. 信息完整性 | 核心 Hook/API/状态转换无遗漏，tags 反映主要技术模式 |

若发现任一维度不满足，立即用 **Edit 工具**补充后继续。

写完文档后，立即**使用 Bash 工具**获取精确 sections lineRange：

```bash
DOC_FULL_PATH="$CONTEXT_PROJECT_DIR/reference/<module>/<featureId>-guide.md"

bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/validate-sections.sh" \
    --doc-path "$DOC_FULL_PATH" \
    --fix
```

将输出保存为 `$SECTIONS_FIX`，用其 lineRange/estimatedTokens，结合 Step 2 的 summary，合并为最终 sections 数组。

> ✅ Step 4 完成。**现在立即输出标题 `## 执行 Step 5：更新 Router JSON`，然后继续执行。**

---

## Step 5: 更新 router/<module>.json

使用 **Edit 工具**，在 `features` 对象末尾新增功能条目：

**路径**: `$CONTEXT_PROJECT_DIR/router/<module>.json`

```json
"<featureId>": {
  "id": "<featureId>",
  "module": "<module>",
  "type": "feature",
  "title": "<title>",
  "summary": "<summary>",
  "discovery_cost": "<FILE_TOKENS_TOTAL + AI 分析估算，格式如 ~3200 tokens>",
  "quickRef": {
    "coreLogic": ["..."],
    "keyComponents": ["..."],
    "keyFiles": ["src/.../..."],
    "relatedConcepts": ["..."]
  },
  "referencePath": "reference/<module>/<featureId>-guide.md",
  "sections": [ /* $SECTIONS_FIX 的结果，summary 替换为 Step 2 生成值 */ ],
  "tags": ["tag1", "tag2"],
  "created": "<YYYY-MM-DD>",
  "updated": "<YYYY-MM-DD>"
}
```

同时在 `history` 对象中追加初始记录：

```json
"history": {
  "<featureId>": [
    {
      "date": "<YYYY-MM-DD>",
      "type": "feat",
      "summary": "初始版本，通过 /k/context learn 从代码自动生成",
      "files": ["keyFiles 中的文件名（不含路径）"]
    }
  ]
}
```

若模块 router JSON 不存在，先创建，格式参考 `router/vault.json`。

> ✅ Step 5 完成后**立即继续 Step 6**。

---

## Step 6: 更新 context-index.json

使用 **Edit 工具**修改以下三处：

**路径**: `$CONTEXT_INDEX_FILE`

**1. 在对应 module 的 features 数组末尾追加**：

```json
"features": ["已有id1", "已有id2", "<featureId>"]
```

> 若为新模块，在 `modules` 数组末尾新增完整 module 条目，并更新 `meta.totalModules`（+1）。

**2. 在 recentQueue 头部插入**（保持队列不超过 10 条，超出删末尾最旧条目）：

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

> ✅ Step 6 完成后**立即继续 Step 7**。

---

## Step 7: 更新反向索引

### files.json

**路径**: `$CONTEXT_PROJECT_DIR/indexes/files.json`

使用 **Edit 工具**，为 `quickRef.keyFiles` 中每个文件添加或追加条目：

- 文件不存在 → 新增 `{ "features": ["<featureId>"], "lastUpdate": "<YYYY-MM-DD>" }`
- 文件已存在 → 在 `features` 追加 `"<featureId>"`，更新 `lastUpdate`

更新 `meta.totalFiles`（仅新增文件路径时 +1）。

### tags.json

**路径**: `$CONTEXT_PROJECT_DIR/indexes/tags.json`

使用 **Edit 工具**，为每个 tag 添加或追加条目：

- tag 不存在 → 新增 `"<tag>": ["<featureId>"]`
- tag 已存在 → 追加 `"<featureId>"`

更新 `meta.totalTags`（仅新增 tag 时 +1）和 `meta.lastUpdated`。

> ✅ Step 7 完成后**立即继续 Step 7b**。

---

## Step 7b: 验证 JSON 结构

**使用 Bash 工具**：

```bash
for f in \
    "$CONTEXT_PROJECT_DIR/router/<module>.json" \
    "$CONTEXT_INDEX_FILE" \
    "$CONTEXT_PROJECT_DIR/indexes/files.json" \
    "$CONTEXT_PROJECT_DIR/indexes/tags.json"; do
    python3 -m json.tool "$f" > /dev/null \
        && echo "✅ $f 格式正确" \
        || echo "❌ $f 格式错误"
done
```

若任何文件验证失败，**立即修复 JSON 语法错误**后再继续。

> ✅ Step 7b 完成后**立即继续 Step 7c**。

---

## Step 7c: 跨文件一致性校验

**使用 Bash 工具**：

```bash
bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/validate-structure.sh" \
    --integrity "$CONTEXT_PROJECT_DIR"
```

若校验发现问题，**立即修复**（通常是 feature ID 未同步到某个索引文件）后再继续。

> ✅ Step 7c 完成后**立即继续 Step 9**。

---

## ~~Step 8~~（已并入 Step 4）

> 质量自检标准已内嵌至 Step 4 写作约束中，写作时同步完成，无需单独执行。

---

## Step 9: 完成输出

在输出以下报告前，逐项确认各步骤已执行（未执行的步骤须立即返回补做）：

```
✅ Context Learn 完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Feature ID : <featureId>
  模块       : <module>
  文档       : reference/<module>/<featureId>-guide.md
  标签       : <tags>

步骤确认：
  ✅ Step 4 reference 已写入（含质量自检）: <DOC_FULL_PATH>
  ✅ Step 5 router 已更新                 : <ROUTER_PATH>
  ✅ Step 6 index 已更新                  : context-index.json
  ✅ Step 7 反向索引已更新                : files.json + tags.json
  ✅ Step 7b JSON 验证通过
  ✅ Step 7c 一致性校验通过

📊 Token 成本
  outline 扫描（Step 1a）     : ~0 tokens（零消耗，shell 脚本）
  keyFiles 全量读取（Step 1b）: ~<ACTUAL_READ_TOKENS> tokens
  AI 分析与写作（Step 2+4）   : ~<估算>
  ─────────────────────────────────────
  本次总计                    : ~<后两项合计> tokens

验证：
  /k/context load <featureId>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
