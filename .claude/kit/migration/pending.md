# Migration Pending(defer 跟踪表)

> 由 `/k:migration analyze` 规则消费清单中标 `defer` 的条目汇总。
> 每次 analyze 开始会读取本文件(Step 4.6),评估历史 defer 是否已到回补条件。
> 每次 verify 会检查本轮 feature 新增的 defer 是否已登记于此。
>
> **维护规则**:
> - 追加:新 feature 标 defer → 本次迁移结束前追加条目
> - 移除:某条被回补实现时 → 从本表删除(或标注 resolved + 日期)

---

## vault-withdraw-cooldown-confirm

- **规则**:shouldShowCooldownConfirm — 当 cooldownAmount>0 或冷却中,点 Withdraw(MAG7)需弹二次确认,防止重置 14 天 lock-up
- **UI 产物**:
  - 顶部 CooldownBanner("X MAG7.ssi will be available to Claim on ...")
  - 二次确认弹窗(Confirmation)
  - helperText
- **延后理由**:vault-withdraw 首版聚焦主干签名流程,cooldown 分支延后
- **触发回补条件**:主干 MAG7 withdraw 成功跑通 + 用户反馈有 cooldown 场景
- **登记时间**:2026-04-23
- **状态**:resolved(2026-04-23 已实现 banner + 独立 confirm modal)

---

## vault-deposit-mobile-trading-figma

- **规则**:Mobile 进行中/失败态 Figma 设计稿未提供,Phase 1 ui-migration 依赖响应式 Shell + PC 进行中稿推断
- **UI 产物**:Trading 组件移动端 CollapsiblePanel 样式 / step 文案 / Try Again 按钮布局
- **延后理由**:Figma 未提供 mobile trading 节点,本次 Phase 1/2 按响应式 Shell 自动处理
- **触发回补条件**:设计补 mobile trading Figma 稿后,回 Phase 1 ui-migration 单跑 Trading 组件,按 Figma 精修
- **登记时间**:2026-04-23
- **状态**:open

## vault-deposit-interruption-modal

- **规则**:钱包拒签时的全局 interruptionModal(老项目有此模式)
- **UI 产物**:modal 弹出提示用户重签 / 取消
- **延后理由**:新项目 modalManager 暂未建 InterruptionDialog 共享组件;Phase 2 初版用 toast 降级
- **触发回补条件**:模块 6(integration)若决定建全局 InterruptionDialog 或模块 3(unstake)/4(withdraw)需要同类模式,统一裁决后回补
- **登记时间**:2026-04-23
- **状态**:open
