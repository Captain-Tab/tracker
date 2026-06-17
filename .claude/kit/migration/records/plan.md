# plan

跨迁移的 **plan 阶段实现假设 / 依赖检查缺失** 类坑。

---

## plan:dependency-existence-check

- **tags**: plan, dependencies, package, assumption
- **severity**: medium
- **created**: 2026-04-22
- **source**: sodex-next vault-claim plan `useVaultClaimForm` 用 react-hook-form 误判

### 触发场景

Plan 阶段根据老项目实现思路写"建议 hook 用 react-hook-form + zod / MobX / axios / ..."类技术栈,但**未核查新项目是否已装对应依赖**。execute 开工才发现要新增 shared 级依赖,破坏 plan 节奏。

### 典型症状

- Plan 文档某步骤写:"新建 `useXxxForm.ts`,react-hook-form + zod 实现"
- Execute 开工 `import { useForm } from "react-hook-form"` → 模块未找到
- 被迫现场降级(改手写 useState + 纯函数校验)或中断 execute 去装包 + 调类型 + 跑 storybook 测试

### 根因

Plan 阶段 AI 倾向**沿用老项目思路**设计实现,但跨项目技术栈可能**有意差异**(新项目瘦身、换了库、或未到该模块)。Plan 只看 spec + 老项目代码,没查新项目的 `package.json`。

### 避坑动作

Plan 阶段对**每个关键库**加一步 `package.json` 存在性检查:

```bash
grep -E "\"(react-hook-form|zod|@hookform/resolvers|axios|mobx|rxjs|decimal.js|viem|wagmi)\"" \
  <project-root>/package.json
```

**未命中的库禁止出现在 plan** 的实现步骤里。如果确实需要,plan 先加"前置 Step: 新增依赖"并标风险。

**Plan 模板建议加一个门**:

```
## Step 0: 依赖核验
- [ ] <库 1> 已在 package.json
- [ ] <库 2> 已在 package.json
- [ ] ...
缺失依赖 → 列入"执行前需先装"或降级替代方案
```

### 检测建议

Plan 产出后 grep 一遍:

```bash
grep -oE "react-hook-form|zod|@hookform|axios|mobx|rxjs|react-query|tanstack" migration-plan-*.md \
  | sort -u
# 逐条对照 package.json 确认
```

### 本次来源

vault-claim plan.md Step 6 写:

> `useVaultClaimForm.ts` — react-hook-form + zod schema(Min / Max / 精度校验)

Execute 批次 A 开工后 `grep react-hook-form package.json` 零命中。降级方案:`useState + claimFlowLogic` 纯函数组合,不新增依赖。Plan **未记录此偏差**,execute 阶段补记到 migration-state.json.executeDeviations。

### 关联

- 迁移时与"降级替代方案"绑定:当依赖不存在,**不要默认装**,先尝试用项目已有组件/hook 替代。
