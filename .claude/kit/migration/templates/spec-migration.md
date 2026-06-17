# 迁移 Spec 模板

> 此模板在标准 /k/spec 基础上追加迁移专属字段。migration spec 子命令自动注入。

---

## 迁移专属字段

### 旧架构描述

> 自动从 analyze 产出 + context load 填充

- **当前实现**：[状态管理方式，如 MobX Store + observer]
- **关键文件**：[从 analyze 产出填充]
- **数据流**：[如 API → Store @action → @observable → observer 组件]
- **核心逻辑摘要**：[功能的业务规则，从 analyze 提取]

### 新架构目标

- **目标分层**：sodex-next 5 层 Clean Architecture
  ```
  UI → Container → Service → Domain → Infra
  ```
- **数据转换路径**：DTO → Domain（normalize.ts）→ ViewModel（useXxxViewModel.ts）
- **状态管理**：React Query（服务端状态）+ Zustand（客户端状态）

### Endpoint 清单

> 从 context reference 预填，提示用户通过 DevTools 确认/补充

| 方法 | 路径 | 用途 | context 记录 | 运行时确认 |
|------|------|------|-------------|-----------|
| GET | /example/api | 示例 | ✅ | ⬜ |

### Breaking Changes

- 导出/接口变更：[哪些导出会变]
- 下游影响：[哪些组件会受影响]
- 类型变更：[DTO/Domain/ViewModel 类型差异]

### 兼容策略

- 新旧共存期间的桥接方案
- 渐进式切换策略

### 回滚方案

- 迁移失败时如何回退
- 需要保留的旧代码路径
