# Context 系统架构设计

## 架构概览

Context 系统采用**四层架构 + CQRS 模式**，实现清晰的读写分离和职责划分。

```
┌─────────────────────────────────────────────────────────┐
│                    Context 系统架构                      │
└─────────────────────────────────────────────────────────┘

         用户命令
            │
            ▼
    ┌───────────────┐
    │  context.md   │  路由层（命令分发）
    │  (路由器)     │
    └───────┬───────┘
            │
    ┌───────┴────────┐
    │                │
    ▼                ▼
┌────────┐      ┌────────┐
│ action │      │ query  │  命令层（读写分离）
│ (写入) │      │ (读取) │
└───┬────┘      └───┬────┘
    │               │
    │ 依赖          │ 依赖
    ▼               ▼
┌────────┐      ┌────────┐
│ shared │      │ indexes│  服务层（工具函数）
│ (工具) │◄─────┤ (索引) │
└───┬────┘      └───┬────┘
    │               │
    └───────┬───────┘
            │
            ▼
    ┌──────────────┐
    │   library    │  数据层（持久化）
    │  (数据存储)  │
    └──────────────┘
```

---

## 目录结构

```
.cursor/kit/context/
│
├── 📝 action/              # 业务层：写入操作
│   ├── record/             # 记录新功能
│   ├── learn/              # 从代码学习
│   ├── update/             # 更新元数据
│   └── remove/             # 删除功能
│
├── 🔍 query/               # 表示层：读取操作
│   ├── query-file.sh       # 文件查询（附加 outline 骨架）
│   └── query-tag.sh        # 标签查询
│
├── 🛠️ tools/               # 工具层：代码分析工具
│   ├── outline.js          # TypeScript AST 符号提取（TS API / 正则降级）
│   └── outline.sh          # outline.js 的 shell 包装器
│
├── 🔧 shared/              # 服务层：共享工具
│   └── update-indexes.sh   # 索引维护
│
└── 📦 library/             # 数据层：持久化
    └── {project}/
        ├── context-index.json
        ├── indexes/
        ├── router/
        ├── reference/
        └── history/
```

---

## 设计原则

### 1. CQRS 模式（命令查询责任分离）

**Command（命令 - action）**：
- 修改系统状态
- 有副作用
- 不返回数据（或返回成功/失败）
- 示例：record, learn, update, remove

**Query（查询 - query）**：
- 只读取数据
- 无副作用
- 返回查询结果
- 示例：query-file, query-tag

**优势**：
- ✅ 读写职责分离，易于理解
- ✅ 可以独立优化读写性能
- ✅ 符合业界最佳实践

---

### 2. 四层架构

| 层级 | 目录 | 职责 | 特点 |
|------|------|------|------|
| **表示层** | query/ | 提供查询接口 | 用户直接调用 |
| **业务层** | action/ | 处理业务逻辑 | 修改数据状态 |
| **服务层** | shared/ | 提供共享服务 | 被业务层依赖 |
| **数据层** | library/ | 数据持久化 | 所有层都可访问 |

**优势**：
- ✅ 职责明确，不会混淆
- ✅ 易于测试和维护
- ✅ 支持水平扩展

---

### 3. 单一职责原则

每个目录只负责一类功能：

**action/**：
- ✅ 只包含"修改数据"的命令
- ❌ 不包含查询逻辑
- ❌ 不包含工具函数

**query/**：
- ✅ 只包含"查询数据"的脚本
- ❌ 不包含修改逻辑
- ❌ 不包含工具函数

**shared/**：
- ✅ 只包含"被多处共享"的工具
- ❌ 不包含命令逻辑
- ❌ 不包含数据存储

**library/**：
- ✅ 只包含"数据和索引"
- ❌ 不包含业务逻辑
- ❌ 不包含命令脚本

---

## 依赖关系

### 调用链

```
用户
  │
  ├─→ /k/context record  ──→ action/record/  ──→ shared/update-indexes.sh ──→ library/
  │
  ├─→ /k/context learn   ──→ action/learn/   ──→ shared/update-indexes.sh ──→ library/
  │
  ├─→ /k/context update  ──→ action/update/  ──→ shared/update-indexes.sh ──→ library/
  │
  ├─→ /k/context remove  ──→ action/remove/  ──→ shared/update-indexes.sh ──→ library/
  │
  ├─→ /k/context file    ──→ query/query-file.sh ──→ library/indexes/
  │                                              └─→ tools/outline.sh ──→ tools/outline.js
  │
  ├─→ /k/context outline ──→ tools/outline.sh   ──→ tools/outline.js
  │
  └─→ /k/context tag     ──→ query/query-tag.sh  ──→ library/indexes/
```

### 依赖图

```
┌──────────┐
│  action  │───────┐
│  (4个)   │       │
└──────────┘       │
                   ▼
┌──────────┐   ┌──────────┐   ┌──────────┐
│  query   │──→│  shared  │──→│ library  │
│  (2个)   │   │  (工具)  │   │  (数据)  │
└──────────┘   └──────────┘   └──────────┘

说明：
→  表示"依赖"或"调用"
所有组件都可以访问 library/
只有 action 依赖 shared/
```

---

## 为什么不合并目录？

### ❌ 方案：query 移入 action

```
action/
├── record/
├── learn/
├── update/
├── remove/
└── query/        ← 问题：query 不是 action！
```

**问题**：
1. query 是"查询"，action 是"动作"，语义冲突
2. 破坏了 CQRS 的读写分离
3. 用户会困惑："为什么查询在动作里？"

---

### ❌ 方案：shared 移入 action

```
action/
├── record/
├── learn/
├── update/
├── remove/
└── shared/       ← 问题：不易发现和维护
```

**问题**：
1. shared 被隐藏在 action 内部
2. 不符合"共享"的语义（应该是顶层）
3. 未来 query 需要工具函数怎么办？

---

### ❌ 方案：合并到 utils

```
utils/
├── indexes/      ← 原 shared
└── queries/      ← 原 query
```

**问题**：
1. query 是用户命令，不应该藏在 utils 下
2. 混淆了"工具函数"和"用户命令"
3. 不符合 CQRS 模式

---

## 业界对比

### Redux Toolkit

```
src/
├── features/     # 功能模块（类似 action）
├── app/          # 应用配置（类似 library）
└── utils/        # 工具函数（类似 shared）
```

### Next.js

```
app/
├── api/          # API 路由（类似 action）
├── [pages]/      # 页面路由（类似 query）
└── lib/          # 工具库（类似 shared）
```

### Django

```
project/
├── views/        # 视图（类似 action）
├── urls/         # 路由（类似 query）
├── utils/        # 工具函数（类似 shared）
└── models/       # 数据模型（类似 library）
```

**共同点**：
- ✅ 写入操作独立
- ✅ 读取操作独立
- ✅ 工具函数独立
- ✅ 数据存储独立

---

## 扩展性设计

### 新增写入命令

```
action/
├── record/
├── learn/
├── update/
├── remove/
└── export/       ← 新增：导出功能
```

### 新增查询命令

```
query/
├── query-file.sh
├── query-tag.sh
└── query-deps.sh ← 新增：依赖查询
```

### 新增工具函数

```
shared/
├── update-indexes.sh
└── validate-data.sh  ← 新增：数据验证
```

**优势**：
- ✅ 知道往哪里放新功能
- ✅ 不需要改动现有结构
- ✅ 不影响其他模块

---

## 总结

当前的四层架构（action + query + shared + library）是经过深思熟虑的设计：

✅ **符合设计模式**：CQRS、四层架构、单一职责
✅ **职责清晰**：一眼看出每个目录的作用
✅ **易于维护**：修改某个功能不影响其他
✅ **易于扩展**：新增功能知道往哪里放
✅ **符合惯例**：与业界主流框架保持一致

**不要为了减少 1 个目录，而牺牲整个架构的清晰度！**

---

## 参考资料

- [CQRS Pattern - Martin Fowler](https://martinfowler.com/bliki/CQRS.html)
- [Four-Layer Architecture](https://en.wikipedia.org/wiki/Multitier_architecture)
- [Single Responsibility Principle](https://en.wikipedia.org/wiki/Single-responsibility_principle)
