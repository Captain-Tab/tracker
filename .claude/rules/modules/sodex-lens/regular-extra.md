# 通用规范（sodex-next 扩展）

## Zustand selector 稳定性

- 禁止 `useXxxStore((s) => ({ ... }))` / `useXxxStore((s) => [ ... ])` 这类直接返回对象或数组字面量的 selector。
- 多字段读取优先拆成多个原子 selector（`useXxxStore((s) => s.a)`、`useXxxStore((s) => s.b)`）。
- 若必须返回对象/数组，必须配套稳定比较（如 `shallow`），避免 `getSnapshot should be cached` 循环告警。

## Shared 基础组件测试门禁

- 凡修改 `src/shared/components/ui`（含样式、结构、交互、a11y、stories），必须先本地跑通 `pnpm test-storybook`，再对外汇报"已完成/已通过"。
- 未执行测试或测试失败时，禁止宣称通过；必须先修复失败项并复测通过后再汇报结果。
