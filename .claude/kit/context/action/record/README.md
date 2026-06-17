# Record 脚本工具集

自动化记录功能到 Context Library 的脚本工具。

## 目录结构

```
.cursor/kit/context/record/
├── README.md                   # 本文档
├── scripts/                    # 脚本工具集
│   ├── record-helpers.sh       # 通用辅助函数
│   ├── merge-spec-history.sh   # 合并 spec 和 history 文档
│   ├── analyze-document.sh     # 分析文档生成 quickRef/sections
│   ├── update-router.sh        # 更新 router/*.json
│   ├── update-index.sh         # 更新 context-index.json
│   ├── validate-structure.sh   # 验证 JSON 结构
│   ├── search-similar.sh       # 搜索相似功能（三级匹配）
│   ├── suggest-feature-id.sh   # 智能推荐 Feature ID
│   ├── suggest-module.sh       # 智能推荐 Module
│   └── suggest-type.sh         # 智能推荐 Type
└── .backup/                    # 自动备份目录
```

## 使用示例

### 通过 /k/record 命令使用

```bash
# 在 Cursor 中执行
/k/record

# 按提示输入功能信息
```

### 通过 /k/check --r 自动调用

```bash
# 在 Cursor 中执行
/k/check --r

# 检查完成后自动执行 /k/record
```

## 脚本说明

### 核心脚本

#### record-helpers.sh
通用辅助函数库，提供 19 个工具函数：
- `read_spec_content()` - 读取 spec 内容
- `extract_core_flowcharts()` - 提取流程图
- `extract_core_components()` - 提取组件列表
- `extract_file_paths()` - 提取文件路径
- `backup_file()` - 文件备份
- `validate_json()` - JSON 验证

#### merge-spec-history.sh
合并 spec 和 history 文档，生成符合 context 规范的 history 文档（8 章节标准格式）。

**参数**：
- `--spec-dir` - spec 目录路径
- `--history-dir` - history 目录路径（可选）
- `--output-path` - 输出文件路径
- `--feature-id` - 功能 ID

#### analyze-document.sh
分析文档生成 quickRef 和 sections JSON。

**参数**：
- `--doc-path` - 文档路径
- `--feature-id` - 功能 ID
- `--module` - 模块 ID

**输出**：JSON 格式，包含 quickRef、sections、tags

**sections 生成规则**：
- 自动提取所有 `## ` 二级标题
- 清理 emoji 和特殊字符
- 计算准确的 lineRange（起始行到下一章节前）
- 估算 tokens（每行约 15 tokens）

#### validate-sections.sh（v2.5.5 新增）
验证 router sections 配置是否与实际文档章节对齐。

**参数**：
- `--doc-path` - 文档路径（必需）
- `--sections` - sections JSON 字符串（可选，用于对比）
- `--verbose, -v` - 显示详细对比
- `--fix` - 生成修复建议（JSON 格式）

**使用场景**：
1. `context load` 时自动检查 sections 配置
2. `context record` 后验证生成结果
3. 手动检查现有文档配置

**示例**：
```bash
# 验证配置
bash validate-sections.sh --doc-path reference/trade/trade-deposit-guide.md \
    --sections "$(jq '.features."trade-deposit".sections' router/trade.json)" \
    --verbose

# 生成修复建议
bash validate-sections.sh --doc-path reference/trade/trade-deposit-guide.md --fix
```

### 智能推荐脚本（v2.3 新增）

#### search-similar.sh
搜索相似功能，三级匹配策略：
- ⭐⭐⭐ 精准 Title 匹配（不区分大小写）
- ⭐⭐ 模糊 Title 匹配（关键词重叠 ≥50%）
- ⭐ Summary 关键词重叠（≥30%）

**参数**：
- `--title` - 标题（必需）
- `--summary` - 摘要（可选）
- `--files` - 修改的文件列表（可选）
- `--index` - context-index.json 路径（必需）

**输出格式**：
```
EXACT|vault-deposit-01|vault|100
FUZZY|vault-withdraw-01|vault|75
SUMMARY|network-switch-01|shared|45
```

#### suggest-feature-id.sh
智能推荐 Feature ID，逻辑：
1. 从 spec 文件名提取
2. 从标题生成
3. 检查已有功能，自动递增编号

**参数**：
- `--title` - 标题（必需）
- `--spec-file` - spec 文件路径（可选）
- `--index` - context-index.json 路径（必需）

**输出示例**：
```
vault-deposit-02
```

#### suggest-module.sh
智能推荐 Module，基于修改的文件路径分析。

**参数**：
- `--files` - 修改的文件列表（可选，默认从 git diff 获取）

**输出示例**：
```
vault
```

#### suggest-type.sh
智能推荐 Type（feat/fix/refactor），**仅用于更新现有功能时**。

**逻辑**：
1. 分析 spec 关键词
2. 读取最近的 commit message

**参数**：
- `--spec-file` - spec 文件路径（可选）
- `--spec-content` - spec 内容（可选）

**输出示例**：
```
fix
```

**注意**：创建新功能时不使用此脚本，类型固定为 `feat`。

### 配置更新脚本

#### update-router.sh
更新 router/*.json 配置文件。

**参数**：
- `--module` - 模块 ID
- `--feature-id` - 功能 ID
- `--title` - 标题
- `--summary` - 摘要
- `--quick-ref` - quickRef JSON
- `--sections` - sections JSON
- `--tags` - 标签（逗号分隔）
- `--reference-path` - reference 路径
- `--history-path` - history 路径（可选）
- `--context-dir` - context 目录

#### update-index.sh
更新 context-index.json。

**参数**：
- `--feature-id` - 功能 ID
- `--module` - 模块 ID
- `--type` - 变更类型
- `--summary` - 摘要
- `--add-to-queue` - 添加到 recentQueue
- `--index-file` - 索引文件路径

#### validate-structure.sh
验证 JSON 结构符合 context v2.2 规范。

**参数**：
- `--index` - context-index.json 路径（可选）
- `--router` - router/*.json 路径（可选）

## 依赖

- `bash` 4.0+
- `jq` 1.5+
- `.cursor/kit/config.sh`
- `.cursor/kit/context/context-lib.sh`
