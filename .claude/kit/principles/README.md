# soso-kit Principles

> 设计思想沉淀层。每个文件描述一条**元原则**——指导 AI 如何运用其他具体规则。

---

## 三层职责

| 层 | 位置 | 职责 | 不要做 |
|---|---|---|---|
| **思想层** | `kit/principles/` | 写 **为什么** 这样设计、反模式分析、决策表 | ❌ 写"如何执行"的具体步骤 |
| **生效层** | `rules/modules/<family>/constitution.md` | 声明优先级 + 引用本目录 | ❌ 展开思想内容 |
| **执行层** | `commands/k/*.md` | 命令本身是原则的具体化 | ❌ 嵌入原则全文重复 |

只要三层职责不越界，未来加多少原则都不会失控。

---

## 当前原则清单

| 原则 | 文件 | 一句话核心 |
|---|---|---|
| **第一性原理** | [`first-principles.md`](./first-principles.md) | 从需求本质出发，不从惯例出发；说该说的，做该做的 |
| **严格 ≠ 繁琐** | [`strict-vs-cumbersome.md`](./strict-vs-cumbersome.md) | 工序层尽量严格，输出层保持简洁，规则层少而精 |
| **证据落地** | [`evidence-grounding.md`](./evidence-grounding.md) | 评级必须能指向源码行号；落不到行号的判断都是脑补 |

---

## 扩展机制

### 新增原则的判断三问

未来想加新原则前，必须三问都过：

1. **是元原则吗？**——指导"如何运用其他规则"，而非"具体怎么做"
2. **现有命令/rules 是否已是它的实现？**——是 → 不必加
3. **不加它会遗漏哪类反复摩擦？**——能具体说出来才加

任一不过 → 不加，避免 principles/ 膨胀成新形式的繁琐。

### 加新原则的步骤

1. 在本目录新建 `<原则名>.md`，模仿现有文件的结构（核心误区 → 模型 → 反/正模式 → 决策表 → 应用 → 总结 → 来源）
2. 在本 README "当前原则清单" 表格追加一行
3. 在 `rules/modules/<family>/constitution.md` 追加一行链接（**只链接，不展开**）

---

## 与 rules/ 的关系

| 类型 | 例子 | 部署位置 |
|---|---|---|
| **元原则** | 第一性原理、严格≠繁琐 | `principles/`（思想） + `constitution.md`（声明） |
| **业务规则** | precision-calculation、wallet-signing | `rules/modules/<family>/*.md` |
| **流程规则** | clean-code、git-commit | `rules/modules/<family>/*.md` |

元原则**优先级高于**业务/流程规则——当具体规则之间冲突时，由元原则裁决。
