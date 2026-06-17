# 迁移专属：类型先行约束

> ⚠️ 仅适用于迁移场景（新建架构 + 新数据结构）。
> 一般任务中 AI 在单对话内上下文连续，各 step 之间自然保持类型一致，不需要强制类型先行。
> 迁移场景涉及 DTO → Domain → ViewModel 多层类型定义，不先统一类型会导致下游返工。

## Step 0: 类型定义（迁移首步）

在任何实现步骤之前，先定义以下类型：

1. **DTO 类型**（与 API 响应字段名一致）
   - 文件：`infra/types.ts` 或 `infra/xxxApi.types.ts`

2. **Domain 类型**（纯业务语义，驼峰命名）
   - 文件：`domain/types.ts`
   - 包含 normalize 函数的输入/输出类型

3. **错误类型**（discriminated union）
   - 文件：`domain/errors.ts`

4. **关键函数签名**
   - Service 层的 Command/Query 函数签名
   - Container 层的 hook 返回类型

**产出**：types 文件，后续所有步骤基于此类型实现。
