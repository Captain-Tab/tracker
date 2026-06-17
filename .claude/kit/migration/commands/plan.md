# Migration Plan: 拆分迁移计划

## 流程

### 1. 读取 migration-spec

读取 `migration-spec-<功能ID>.md`。

### 2. 坑点检查（PROJECT_NAME=sodex-next）

```bash
source "$KIT_ROOT/.claude/kit/context/context-lib.sh" && init_context_config
bash "$KIT_ROOT/.claude/kit/context/query/query-pitfall-gates.sh" "<从 spec 提取的 tags>"
```

### 3. 复用检查（PROJECT_NAME=sodex-next）

```bash
bash "$KIT_ROOT/.claude/kit/plan/reusable-match.sh" "$CONTEXT_PROJECT_DIR/reusable/index.md" "<tags>"
```

### 4. 类型先行约束（按需）

涉及新数据结构时，读取类型先行模板：
```bash
# Read: $KIT_ROOT/.claude/kit/migration/templates/plan-type-first.md
```

判断条件：spec 中包含 DTO/Domain/ViewModel 类型变更 → 加载；否则跳过。

### 5. 调用 /k/plan 引擎

注入迁移专属约束：
- 涉及新数据结构时 Step 0 为类型定义（按需，非强制）
- 步骤按目标架构分层排序（Infra → Domain → Service → Container → UI）

### 6. 输出迁移计划

保存 `migration-plan-<功能ID>.md`。

### 7. 更新 migration-state.json

---

## Token 估算

步骤完成后，估算本步 token 消耗并写入 migration-state.json.tokenEstimates.plan：

```
inputChars = spec 文档 + pitfall 匹配结果 + reusable 匹配结果 + 类型先行模板（如加载）
outputChars = 生成 plan 文档字符数
estimatedTokens = (inputChars + outputChars) / 4
```

预期范围：~500-800 tokens
