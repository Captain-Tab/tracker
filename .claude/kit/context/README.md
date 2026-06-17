# Context 上下文管理系统

## 概述

Context 是 soso-kit 的上下文管理系统，通过四层渐进式披露优化 token 消耗：

- **L1（索引）**: ~800 tokens - 快速浏览功能列表
- **L2（快速参考）**: ~200 tokens/功能 - 核心逻辑摘要
- **L2.5（章节索引）**: ~600 tokens - 长参考文档的章节摘要
- **L3（完整文档）**: 按需加载 - 详细实现文档

**Token 节省率**: 85-94%

**混合策略**：
- 短文档（<300行）：直接 L1 → L2 → L3
- 长文档（>400行）：L1 → L2 → L2.5 → L3

---

## 目录结构

```
.cursor/kit/context/            # context 系统（自包含）
├── context-lib.sh              # 核心函数库
├── README.md                   # 本文档
│   (变更日志已迁移至 .claude/version/kit/context.md，由 /k:version 管理)
│
├── action/                     # 写入操作（所有修改命令）⭐ v2.5.1
│   ├── record/                 # 记录功能
│   │   ├── scripts/
│   │   │   ├── record-helpers.sh
│   │   │   ├── merge-spec-history.sh
│   │   │   ├── analyze-document.sh
│   │   │   ├── search-similar.sh
│   │   │   ├── suggest-*.sh (3个)
│   │   │   ├── update-router.sh
│   │   │   └── update-index.sh
│   │   ├── README.md
│   │   ├── DESIGN.md
│   │   └── INDEXES.md
│   │
│   ├── learn/                  # 代码学习（AI 分析）
│   │   ├── scripts/
│   │   │   └── learn-from-code.sh
│   │   └── EXAMPLE.md
│   │
│   ├── update/                 # 更新功能元数据
│   │   └── scripts/
│   │       └── update-feature.sh
│   │
│   └── remove/                 # 删除功能
│       └── scripts/
│           └── remove-feature.sh
│
├── query/                      # 读取操作（查询命令）
│   ├── query-file.sh           # 文件查询脚本
│   └── query-tag.sh            # 标签查询脚本
│
├── library/                    # 数据存储
│   └── {project-name}/         # 项目目录
│       ├── context-index.json  # 主索引（L1，轻量级）
│       │
│       ├── indexes/            # 反向索引
│       │   ├── files.json      # 文件反向索引
│       │   └── tags.json       # 标签索引
│       │
│       ├── router/             # 路由配置（模块配置）
│       │   ├── vault.json
│       │   ├── shared.json
│       │   └── ...
│       │
│       ├── reference/          # 长期参考文档
│       │   ├── vault/
│       │   └── ...
│       │
│       └── history/            # 历史记录
│           ├── vault/
│           └── ...
│
└── shared/                     # 共享工具
    └── update-indexes.sh       # 索引维护脚本
```

**模块化架构**：
- **context-index.json**: 主索引（76行），只包含模块列表和最近更新
- **router/*.json**: 模块配置，每个模块独立管理其所有功能
- **按需加载**: 查询时动态加载相关模块配置，提升性能

---

## 使用方法

### 访问控制（重要）⭐

Context library 采用**只读 + 主仓库更新**的权限模型：

| 位置 | 权限 | 说明 |
|------|------|------|
| **soso-kit 主仓库** | 读写 | 可查询 + 可更新 context |
| **Worktree（如 sodex-web-stake）** | 只读 | 只可查询，无法修改 |

**设计理由**：
- ✅ 单一数据源：避免多处修改导致冲突
- ✅ 数据一致性：所有更新在主仓库统一管理
- ✅ 审计友好：所有修改可追溯

### 查询命令（只读，任何位置可用）

```bash
# 显示所有功能列表
/k/context list
/k/context ls

# 搜索功能
/k/context search <keyword>
/k/context s vault

# 加载文档（长文档会先显示章节索引）
/k/context load <feature-id>
/k/context l vault-deposit-01  # 显示 L2.5 章节索引 + L3 完整文档
/k/context l transfer-01       # 直接显示 L3 完整文档（短文档）

# 查询文件相关功能
/k/context file <file-path>
/k/context f src/hooks/useAutoSwitchNetwork.ts

# 查询标签相关功能
/k/context tag <tag-name>
/k/context tag state-machine

# 显示帮助
/k/context help
```

### 更新命令（需在 soso-kit 主仓库执行）

```bash
# 记录新功能（基于 spec + history）
/k/context-record

# 从代码学习生成文档（AI 分析代码）⭐ NEW
/k/context-learn <code-path>
/k/context-learn src/hooks/useAutoSwitchNetwork.ts

# 更新功能元数据
/k/context-update <feature-id>
/k/context-update vault-deposit

# 删除功能
/k/context-remove <feature-id>

# 检测文档是否需要更新
/k/context-audit <feature-id>
```

**learn vs record 的区别**：
- **record**: 新功能开发 → 有 spec 文档 → 基于 spec + history 生成 Context
- **learn**: 理解旧代码 → 无 spec 文档 → AI 分析代码生成 Context
- 互补关系：record 用于标准化流程，learn 用于快速建立上下文

**如果在 worktree 中尝试更新**：
```bash
$ /k/context add
❌ 只读模式：当前在 worktree 中，无法修改 context library

💡 如需更新 context，请在 soso-kit 主仓库中执行：
   cd ~/Documents/code/soso-kit
   /k/context <update-command>
```

### 使用示例

#### 1. 快速浏览项目功能（L1）

```bash
/k/context list
```

输出：
```
📋 功能列表 (sodex-web)

⚡ Features (业务功能与核心流程)
  [vault-deposit-01] Vault Deposit 完整流程
    Base Chain + Value Chain 双层状态机...
    更新: 2026-02-05

🏗️ Infrastructure (基础设施与架构支持)
  [transfer-01] Transfer SOSO EVM 余额即时更新
    修复 Spot → Funding(EVM) Transfer 后余额不即时更新...
    更新: 2026-02-13
```

#### 2. 搜索相关功能

```bash
/k/context search modal
```

查找包含 "modal" 关键词的所有功能。

#### 3. 查看功能详细信息（L2.5 + L3）

```bash
/k/context load vault-deposit-01
```

输出示例：
```
📄 加载文档: vault-deposit-01

📑 章节索引 (L2.5)

[1] 架构概览 [3-35] (~500 tokens)
    分层状态机设计（Base Chain + Value Chain 双层协调）...

[2] 状态转换 [38-65] (~400 tokens)
    完整的状态转换表和流转图...

[3] 核心流程 [69-105] (~600 tokens)
    Base Chain 和 Value Chain 详细步骤...

...（共9个章节）

---

📖 完整文档 (L3)

文件路径: reference/vault/vault-deposit-guide.md
---

# Vault Deposit 功能指南
...（完整文档内容）
```

**渐进式查阅**：
- 先看章节索引（L2.5，~600 tokens），了解文档结构
- 根据行号范围定位感兴趣的章节
- 阅读完整文档获取详细信息（L3，~5900 tokens）

#### 4. 追踪功能演进

```bash
/k/context timeline vault-deposit-01
```

输出：
```
📅 功能演进时间线: vault-deposit-01

功能: Vault Deposit 完整流程
总更新次数: 3

[2026-02-05] [fix]
  修复新用户 Enable Trading 跳过问题
  文件: useVaultDeposit.ts, useBaseChainDeposit.ts

[2025-12-19] [fix]
  Value Chain 失败状态 UI 优化
  文件: useValueChainDeposit.tsx, Trading.tsx
```

#### 5. 查找文件相关变更

```bash
/k/context files chainAsset.ts
```

列出所有涉及该文件的功能和修改。

---

## 工作原理

### 1. 初始化与权限控制

当执行 `/k/context` 命令时：

1. 加载 `context-lib.sh` 函数库
2. 从当前目录向上查找 `.cursor/kit/library`
3. 根据 git 项目名自动识别项目（支持 worktree 映射）
4. 读取 `context-index.json` 索引文件
5. **检测权限模式**：
   - 在 soso-kit 主仓库 → 读写模式
   - 在 worktree 中 → 只读模式

### 2. 项目映射机制

支持将多个 worktree 映射到同一项目：

```bash
# 项目映射规则（context-lib.sh）
case "$git_repo_name" in
    sodex-web*)
        # 所有 sodex-web-* 仓库都映射到 sodex-web 项目
        PROJECT_NAME="sodex-web"
        ;;
    soso-kit*)
        PROJECT_NAME="soso-kit"
        ;;
    *)
        # 其他项目保持原名
        PROJECT_NAME="$git_repo_name"
        ;;
esac
```

**效果**：
- `sodex-web` → `library/sodex-web/`
- `sodex-web-stake` → `library/sodex-web/` （映射）
- `sodex-web-network` → `library/sodex-web/` （映射）

所有 worktree 访问同一份 context 数据。

### 2. 数据结构

#### context-index.json 结构

```json
{
  "meta": {
    "version": "1.0",
    "project": "sodex-web",
    "lastUpdated": "2026-02-15T10:30:00Z",
    "totalFeatures": 3
  },
  "categories": {
    "components": { "name": "...", "emoji": "🧩", "items": [...] },
    "features": { "name": "...", "emoji": "⚡", "items": [...] },
    "infrastructure": { "name": "...", "emoji": "🏗️", "items": [...] }
  },
  "reference": {
    "feature-id": {
      "id": "vault-deposit-01",
      "category": "features",
      "title": "Vault Deposit 完整流程",
      "summary": "...",
      "quickRef": {
        "coreLogic": ["...", "..."],
        "keyComponents": ["...", "..."],
        "keyFiles": ["...", "..."],
        "relatedConcepts": ["...", "..."]
      },
      "tags": ["vault", "deposit"],
      "created": "2025-12-05",
      "updated": "2026-02-05"
    }
  },
  "history": {
    "recentQueue": [
      {
        "id": "transfer-01",
        "date": "2026-02-13",
        "type": "fix",
        "summary": "..."
      }
    ],
    "items": {
      "feature-id": [
        {
          "date": "2026-02-05",
          "type": "fix",
          "summary": "...",
          "files": ["file1.ts", "file2.tsx"],
          "historyPath": "history/features/vault-deposit/20260205-fix.md"
        }
      ]
    }
  },
  "indexes": {
    "byFiles": { "src/file.ts": ["feature-id"] },
    "byTags": { "vault": ["feature-id"] },
    "byDate": { "2026-02": ["feature-id"] },
    "byType": { "fix": ["feature-id"] }
  }
}
```

### 3. 查询流程

```
用户执行命令
    ↓
解析子命令和参数
    ↓
┌─────────────────────────────────────┐
│ list: 读取 categories + reference   │
│ search: 全文搜索 reference          │
│ recent: 读取 history.recentQueue    │
│ load: 读取 historyPath 文档         │
│ timeline: 读取 history.items        │
│ files: 查询 indexes.byFiles         │
└─────────────────────────────────────┘
    ↓
返回结果（L1/L2/L3 按需）
```

---

## 维护指南

### 添加新模块

1. **创建模块配置文件** `router/{module}.json`：
   ```json
   {
     "module": "your-module",
     "name": "Your Module",
     "description": "模块描述",
     "emoji": "🎯",
     "features": {},
     "history": {}
   }
   ```

2. **更新主索引** `context-index.json`：
   ```json
   {
     "modules": [
       {
         "id": "your-module",
         "name": "Your Module",
         "description": "模块描述",
         "emoji": "🎯",
         "configPath": "router/your-module.json",
         "features": []
       }
     ]
   }
   ```

3. **创建文档目录**：
   ```bash
   mkdir -p history/your-module
   mkdir -p reference/your-module
   ```

4. 无需修改 `context-lib.sh`，自动支持新模块！

### 添加新功能

1. 在 `reference/{module}/` 或 `history/{module}/` 下创建 markdown 文档
2. 更新对应的 `router/{module}.json`:
   - 在 `features` 中添加功能配置（包含 quickRef、sections、tags等）
   - 在 `history` 中添加历史记录
3. 更新 `context-index.json`:
   - 在对应模块的 `features[]` 中添加功能 ID
   - 添加到 `recentQueue`（最多保留最近 10 条）

### Sections 配置规范（v2.5.5）

`router/*.json` 中的 `sections` 配置用于渐进式加载，必须与文档章节对齐：

**配置要求**：
- 每个 `## ` 二级标题对应一个 section
- `title` 应与文档标题一致（清理 emoji 后）
- `lineRange` 必须准确：`[起始行, 结束行]`
- `summary` 简要描述章节内容（50-100字）
- `estimatedTokens` 估算（每行约 15 tokens）

**验证工具**：
```bash
# 验证现有配置
bash .cursor/kit/context/action/record/scripts/validate-sections.sh \
    --doc-path reference/trade/trade-deposit-guide.md \
    --sections "$(jq '.features."trade-deposit".sections' router/trade.json)" \
    --verbose

# 生成修复建议
bash .cursor/kit/context/action/record/scripts/validate-sections.sh \
    --doc-path reference/trade/trade-deposit-guide.md --fix
```

**常见问题**：
- lineRange 偏移：文档修改后未更新配置
- 章节缺失：新增章节未添加到 sections
- 章节多余：删除章节未从 sections 移除

### 模块分类规则

- **vault**: Vault 充值提现与流动性功能
- **stake**: 质押相关功能
- **network**: 网络切换与多链支持
- **points**: 积分与奖励系统
- **shared**: 共享基础设施与通用功能

### reference vs history

- **reference**: 长期有效的参考文档（架构指南、核心流程），持续更新
- **history**: 时间点快照的历史记录（修复、优化），追加式记录

---

## API 参考

### context-lib.sh 函数

```bash
# 查找 soso-kit 根目录
find_kit_root() -> string

# 初始化配置
init_context_config() -> void
  # 设置环境变量:
  # - CONTEXT_LIBRARY_DIR
  # - PROJECT_NAME
  # - CONTEXT_PROJECT_DIR
  # - CONTEXT_INDEX_FILE

# 检查索引文件
check_index_file() -> boolean

# 子命令函数
context_list() -> void
context_search(keyword: string) -> void
context_recent() -> void
context_load(feature_id: string) -> void
context_timeline(feature_id: string) -> void
context_files(file_pattern: string) -> void
```

### 环境变量

```bash
# 项目名称（可手动设置覆盖自动检测）
export PROJECT_NAME="sodex-web"

# 上下文库根目录（自动设置）
CONTEXT_LIBRARY_DIR="/path/to/soso-kit/.cursor/kit/library"

# 项目上下文目录（自动设置）
CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/$PROJECT_NAME"

# 索引文件路径（自动设置）
CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
```

---

## 故障排除

### 问题 1: "未找到 soso-kit 项目根目录"

**原因**: 当前目录不在 soso-kit 项目或其子目录中。

**解决**:
```bash
cd /path/to/soso-kit
/k/context list
```

### 问题 2: "索引文件不存在"

**原因**: 项目的 context-index.json 未创建。

**解决**:
```bash
# 创建项目目录
mkdir -p .cursor/kit/context/library/{project-name}

# 复制模板或手动创建 context-index.json
cp .cursor/kit/context/library/sodex-web/context-index.json .cursor/kit/context/library/{project-name}/
```

### 问题 3: PROJECT_NAME 识别错误

**原因**: Git 项目名与实际项目不匹配。

**解决**:
```bash
# 手动设置项目名
export PROJECT_NAME="your-project"
/k/context list
```

---

## 示例项目

当前系统包含 1 个示例项目：

### sodex-web

包含 3 个功能：
- **vault-deposit-01**: Vault Deposit 完整流程
- **transfer-01**: Transfer SOSO EVM 余额即时更新
- **network-switch-01**: 统一网络切换逻辑

查看示例：
```bash
export PROJECT_NAME="sodex-web"
/k/context list
```

---

## 相关文档

- 命令定义: [.cursor/commands/k/context.md](../../commands/k/context.md)
- 实施计划: [~/.claude/plans/linked-riding-pnueli.md](~/.claude/plans/linked-riding-pnueli.md)
- 配置文件: [.cursor/kit/config.sh](../config.sh)

---

最后更新: 2026-02-15
