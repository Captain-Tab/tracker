# 索引设计 (Indexes Design)

## 概览

Context v2.3 引入了 **混合索引方案**（反向索引 + 功能标签），用于优化查询性能：

- **文件反向索引** (`indexes/files.json`): file-path → features[]
- **功能标签索引** (`indexes/tags.json`): tag-name → feature-ids[]

## 设计目标

### 问题
- Context v2.1/v2.2 查询需要遍历所有 router/*.json（O(n) 复杂度）
- 大型项目（100+ 功能）索引文件会膨胀到 700KB
- 无法快速回答："这个文件涉及哪些功能？"

### 方案
- **反向索引**: O(1) 查询文件 → 功能映射
- **分离索引**: 保持 context-index.json 轻量（5KB）
- **功能标签**: 支持概念级查询（state-machine、bridge）

## 文件结构

```
.cursor/kit/context/library/sodex-web/
├── context-index.json      # 5KB - 轻量级主索引
├── indexes/
│   ├── files.json          # 文件反向索引
│   └── tags.json           # 功能标签索引
└── router/
    ├── vault.json
    ├── stake.json
    └── ...
```

## 索引格式

### files.json - 文件反向索引

```json
{
  "meta": {
    "lastUpdated": "2026-02-17",
    "totalFiles": 13,
    "description": "文件反向索引：file-path → features[]"
  },
  "index": {
    "src/hooks/useAutoSwitchNetwork.ts": {
      "features": ["network-switch-01"],
      "lastUpdate": "2026-02-06"
    },
    "src/components_tw/modals/spot/transfer/index.tsx": {
      "features": ["transfer-01", "network-switch-01"],
      "lastUpdate": "2026-02-13"
    }
  }
}
```

**用途**: 回答 "我在修改 `useAutoSwitchNetwork.ts`，它涉及哪些功能？"

### tags.json - 功能标签索引

```json
{
  "meta": {
    "lastUpdated": "2026-02-17",
    "totalTags": 13,
    "description": "功能标签索引：tag-name → feature-ids[]"
  },
  "index": {
    "state-machine": ["vault-deposit-01"],
    "bridge": ["vault-deposit-01"],
    "multi-chain": ["vault-deposit-01", "network-switch-01"],
    "polling": ["transfer-01"]
  }
}
```

**用途**: 回答 "哪些功能使用了状态机模式？" → `["vault-deposit-01"]`

## 标签策略

### ✅ 功能级标签（推荐）
仅使用 **概念标签**，用于描述代码中不明显的模式：
- `state-machine` - 使用状态机模式
- `bridge` - 跨链桥接逻辑
- `polling` - 轮询机制
- `optimistic-update` - 乐观更新策略

### ❌ 文件级标签（不推荐）
不需要为文件类型打标签，文件路径本身就是最好的标签：
- `src/hooks/` → 这是 hook
- `src/pages/vault/` → 这是 vault 相关页面
- `src/models/` → 这是 MobX model

## 维护机制

### 自动更新
`/k/record` 命令在 Step 7 后自动调用 `update-indexes.sh`:

```bash
bash .cursor/kit/context/shared/update-indexes.sh \
    --project sodex-web \
    --feature-id vault-deposit-01
```

### 数据来源
- **文件索引**: 从 `quickRef.keyFiles[]` 提取
- **标签索引**: 从 `tags[]` + `quickRef.relatedConcepts[]` 提取

### 增量更新
- 新文件 → 创建条目
- 已有文件 → 添加 feature-id 到数组（如果尚未包含）
- 新标签 → 创建条目
- 已有标签 → 添加 feature-id 到数组

## 查询示例

### 1. 查询文件涉及的功能
```bash
# Input: 我在修改 src/hooks/useAutoSwitchNetwork.ts
jq -r '.index["src/hooks/useAutoSwitchNetwork.ts"].features[]' \
    .cursor/kit/context/library/sodex-web/indexes/files.json

# Output: network-switch-01
```

### 2. 查询使用某个概念的功能
```bash
# Input: 哪些功能使用了状态机？
jq -r '.index["state-machine"][]' \
    .cursor/kit/context/library/sodex-web/indexes/tags.json

# Output: vault-deposit-01
```

### 3. 查询一个功能的详细信息
```bash
# 先查 context-index.json 获取模块
MODULE=$(jq -r '.modules[] | select(.features[] == "vault-deposit-01") | .id' \
    .cursor/kit/context/library/sodex-web/context-index.json)

# 再查对应 router/*.json 获取详情
jq '.features["vault-deposit-01"]' \
    .cursor/kit/context/library/sodex-web/router/$MODULE.json
```

## 性能对比

| 操作 | v2.2 (无索引) | v2.3 (索引) | 提升 |
|------|--------------|-------------|------|
| 查询文件 → 功能 | O(n) 遍历 | O(1) 查询 | 100x |
| 查询标签 → 功能 | O(n) 遍历 | O(1) 查询 | 100x |
| 文件大小 | 700KB (大项目) | 5KB + 索引 | 分离 |

## 迁移指南

### 从 v2.2 迁移到 v2.3

1. **创建索引目录**
   ```bash
   mkdir -p .cursor/kit/context/library/sodex-web/indexes
   ```

2. **生成初始索引**
   ```bash
   # 为每个功能运行
   bash .cursor/kit/context/shared/update-indexes.sh \
       --project sodex-web \
       --feature-id <feature-id>
   ```

3. **更新 context-index.json**
   ```json
   {
     "meta": {
       "version": "2.3",
       "indexes": {
         "files": "indexes/files.json",
         "tags": "indexes/tags.json"
       }
     }
   }
   ```

## 设计决策

### 为什么不使用 hotFiles 缓存？
- **低价值（⭐）**: `git log` 已提供更准确的最近修改信息
- **高维护成本**: 需要持续更新缓存
- **决策**: 移除 hotFiles，优先使用 git log

### 为什么不使用 Elasticsearch/全文搜索？
- **过度设计**: 对于 100-500 功能规模，反向索引已足够
- **维护成本**: 需要独立服务，增加复杂度
- **决策**: 保持简单的 JSON 索引，未来可扩展

### 为什么不使用图数据库？
- **当前需求未覆盖**: 尚未需要复杂的功能依赖图
- **迭代策略**: 先用反向索引，未来如需功能依赖分析再引入图结构
- **决策**: 保持平面结构，预留扩展空间

## 未来优化

### P0 - 已完成
- ✅ 文件反向索引
- ✅ 功能标签索引
- ✅ 自动维护脚本

### P1 - 下阶段
- [ ] `/k/context query` - 查询命令（file/tag/module）
- [ ] 语义化搜索（基于 quickRef.summary 的相似度）
- [ ] 自动标签推荐（分析代码模式自动打标签）

### P2 - 长期
- [ ] 功能依赖图（feature-id → depends-on[]）
- [ ] Web UI 可视化索引
- [ ] 跨项目索引（monorepo 场景）

## 相关文件

- `update-indexes.sh` - 索引维护脚本
- `record.md` - Step 7 后调用索引更新
- `DESIGN.md` - 整体设计文档
- `.claude/version/kit/context.md` - 变更日志（v2.3 等更新记录）
