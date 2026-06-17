# ui-progress

跨迁移的**多步骤 UI 进度展示**类坑(step 与事件映射、modal 叠加、loading 态)。

---

## ui-progress:step-to-event-mapping

- **tags**: ui, progress, step, wallet-signing, loading
- **severity**: medium
- **created**: 2026-04-23
- **source**: sodex-web → sodex-next vault-withdraw

### 触发场景

实现带多步骤 progress UI 的流程(如 `StepProcess` 组件 + 多次钱包签名/tx 提交)。step 语义边界 vs 代码执行边界容易错位。

### 典型症状

- spinner 空转(step N 显示 active 但无任何 wallet popup)
- step M 签名期间 spinner 还在 step N
- 用户感知"某一步没对应操作"

### 根因

phase 状态推进回调放错位置。典型:
```ts
// ❌ 错:两次签名都完成后才推进
const sig1 = await signPermit();
const sig2 = await signOuter();
onSigned?.();  // 此时 step 1 才切 active,但签名已结束

// ✅ 对:每个可观察事件对齐一个 step
const sig1 = await signPermit();  // step 0 (approving) 覆盖 popup 1
onSigned?.();  // 推进到 step 1
const sig2 = await signOuter();  // step 1 (redeeming) 覆盖 popup 2
```

### 避坑动作

analyze 阶段对多步骤 UI **逐 step 填"覆盖事件"**:

| step | 覆盖事件 | wallet popup | 等 tx | event 解析 |
|------|---------|-------------|-------|----------|
| 0 Approve | permit 签名 | #1 | — | — |
| 1 Redeem | outer 签名 + tx | #2 | ✓ | Redeem event |
| 2 Unstake | unstake 2 次签名 + tx | #3 #4 | ✓ | — |

每个 step 至少覆盖一个可观察事件;多个事件映射一个 step 时用户会感到"操作凭空发生",多个 step 对应同一事件时 spinner 空转。

### 避坑门禁(已落地 analyze.md)

`analyze.md §Context 规则消费清单 §常见容易漏掉的规则类型` 条目:

> 多步骤 UI 的 "step → 事件" 映射:带 N 次 wallet 签名/tx 提交/event 到达的流程,必须逐 step 标注它覆盖哪个具体事件

### 关联
- 老项目 `useProcessOptions.tsx` 通过每个 option 的 `active` 回调推进,事件边界清晰
- 新项目 phase 枚举 idle/approving/redeeming/unstaking;回调 `onSigned` 位置决定 step 切换时机


---

## ui-progress:modalManager-queue-not-stack

- **tags**: ui, modal, modalManager, nested, Radix
- **severity**: high
- **created**: 2026-04-23
- **source**: sodex-web → sodex-next vault-withdraw(cooldown 二次确认)

### 触发场景

在已打开的 modal 内需要再弹另一个 modal(如"二次确认"、"提示警告"、"嵌套选择器")。

### 典型症状

- 第二层 modal 完全不显示;关闭第一层 modal 后才冒出来
- 多次触发后,关闭第一层会看到"一直弹出"(多个 modal 串行闪现)

### 根因

`shared/infra/modalManager` 的 `openResponsive` / `openModal` / `enqueueResponsive` **都是队列语义**:同一队列里多个 modal 串行展示,不是栈式叠加。从已打开的 modal 内再 `openResponsive`,新 modal 入队,要等当前 modal 关闭才能冒出。

### 避坑动作

**需要栈式叠加(一个 modal 浮在另一个之上)时,不走 modalManager**:

1. 用 Radix `<Dialog>`(项目内 `@/shared/components/ui` 已封装):
   - Radix 自动 Portal 到 `document.body`
   - 独立遮罩 + z-index 栈
   - 支持嵌套 Dialog

2. 组件内部:
```tsx
<Dialog
  open={showingConfirm}
  onOpenChange={(open) => { if (!open) setShowingConfirm(false); }}
  title="Confirmation"
  classes={{ content: "w-[520px]" }}
>
  ...确认内容...
</Dialog>
```

3. 父 modal 的 form 继续渲染,Dialog 叠加在上层

### 验证方法

触发两层 modal 后打印 React tree / DOM,确认:
- 外层 modal 在 `#modal-root` 或 modalManager portal
- 内层 Radix Dialog 在 `document.body` 末尾(Radix 自己的 portal)

### 关联
- 老项目用自家 `createModal` 管理,语义类似队列,踩过相同坑
- 新项目 `openModal` API 注释明确写"返回 Promise, resolve/undefined",暗含"单实例串行"


---

## ui-progress:defer-item-tracking

- **tags**: migration, defer, pending, followUp
- **severity**: medium
- **created**: 2026-04-23
- **source**: sodex-web → sodex-next vault-withdraw(cooldown banner + 二次确认)

### 触发场景

analyze 阶段 Context 规则消费清单里标 `defer` 的规则,需要有机制确保后续真正回补。

### 典型症状

defer 的规则随 feature 迭代遗忘,直到用户反馈或 bug 报出才补上。本次 vault-withdraw 的 cooldown banner + 二次确认弹窗就是这样漏到用户测试才发现。

### 根因

`defer` 只登记在 analyze 报告表格里,没有跨 feature 的跟踪机制。verify 阶段也不强制检查 defer 项有没有 followUp 入口。

### 避坑动作(已落地)

analyze.md / verify.md / pending.md 三处机制:

1. **analyze.md §Context 规则消费清单**:表格第 4 列 `followUp`,`defer`/`skip` 必填,指向 `pending.md` 条目锚点 / issue 链接 / 代码 TODO 锚点
2. **kit/migration/pending.md**(新)作为 defer 跟踪表,每次 analyze Step 4.6 `cat pending.md` 全量注入,评估历史 defer 是否到回补触发条件
3. **verify.md 行为验证清单**增加 3 条检查:implement 逐 UI 产物 / defer followUp 完整性 / pending.md 一致性

### 关联
- 本次 vault-withdraw 遗漏的 cooldown banner + 二次确认就是典型;回补时已登记 `vault-withdraw-cooldown-confirm` 条目(已 resolved)
