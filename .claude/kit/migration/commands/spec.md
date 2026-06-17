# Migration Spec: 生成迁移规范

## 流程

### 1. 读取 analyze 产出

读取 `migration-analyze-<功能ID>.md`。优先读取 `MIGRATION_SUMMARY` 区块（~200 tokens），仅在需要细节时读取完整报告。

### 2. 加载迁移参考（按需）

```bash
REFS_DIR="$KIT_ROOT/.claude/kit/context/library/sodex-next/migration-references"
```

根据功能类型按需加载：
- 涉及错误处理 → `$REFS_DIR/error-handling.md`
- 涉及 WS → `$REFS_DIR/websocket.md`
- 涉及钱包签名 → `$REFS_DIR/wagmi.md`

### 3. 加载迁移 spec 模板

```bash
# Read: $KIT_ROOT/.claude/kit/migration/templates/spec-migration.md
```

### 4. 调用 /k/spec 引擎

注入迁移模板中的专属字段：旧架构描述、新架构目标、Endpoint 清单、Breaking Changes、兼容策略、回滚方案。

从 analyze 产出自动填充"旧架构描述"和"Endpoint 清单"。

### 4.5 交互边界约束（涉及 UI 交互时必填）

凡 spec 涉及以下任一场景，**必须**在 spec 文档中新增「交互边界约束」章节：
- 弹窗/Dialog 的打开、关闭、层叠
- 按钮触发 auth 流程（Enable Trading / Connect Wallet / Sign）
- mutation 生命周期（onMutate / onError / onSettled / cancel）
- 状态过渡动画 / Toast 显示时序

章节格式：

```markdown
## 交互边界约束（Interaction Constraints）

| 触发点 | 行为 | 禁止 |
|-------|------|------|
| Enable Staking 按钮 | 只调 enableTrading()，不进 mutation | 禁止在 mutation 内调 ensureApiKey |
| Dialog 关闭 | cancelledRef = true | 禁止用 reset() 替代取消 |
| 成功 Toast | 在 onSettled 里显示（closeNotify 之后） | 禁止在 onSuccess 里显示（会被 onSettled 关掉）|
```

> **目的**：execute 阶段直接对照约束核对，避免靠经验推断导致反复修复。

### 5. 输出迁移 spec

保存 `migration-spec-<功能ID>.md`，包含 MIGRATION_SUMMARY 区块。

### 6. 更新 migration-state.json

---

## Token 估算

步骤完成后，估算本步 token 消耗并写入 migration-state.json.tokenEstimates.spec：

```
inputChars = analyze 摘要 + spec 模板 + references（如加载）
outputChars = 生成 spec 文档字符数
estimatedTokens = (inputChars + outputChars) / 4
```

预期范围：~800-1200 tokens
