---
id: radix-dialog-focusscope-blocks-external-click
tags: [radix-ui, dialog, modal, sonner, toast, focusscope, pointer-events]
related_feature: vault
severity: high
gate: true
gate_rule: 弹窗内流程中需要同时操作弹窗外元素（toast/通知/悬浮按钮）时，必须检查 FocusScope trap 是否会拦截外部点击
trigger: [dialog, modal, toast, 弹窗, 通知, 点击无效, 无法点击, pointer-events]
date: 2026-04-26
---

# Radix Dialog `modal=true` 的 FocusScope 会阻止弹窗外元素被点击

## 问题描述

Radix Dialog 打开时，弹窗外的 Sonner toast X 按钮点击完全无响应。
表面上看像 z-index 问题（toast 被遮住），实际上与 z-index 无关。

## 调试过程中的误判

依次尝试了以下方向，均无效：
1. 调整 Sonner `z-index`（CSS + style prop + createPortal）
2. 给 DialogOverlay 加 `pointer-events-none`
3. 修改 `notify.tsx` 的 dismiss 逻辑（以为是 toast.dismiss 不生效）
4. 分析 Sonner v2 的 `duration: Infinity` 行为

耗费大量 token 原因：把"可见但点不到"误判为渲染层问题，实际是事件捕获层问题。

## 根因

Radix Dialog `modal=true`（默认）会激活 `FocusScope trapped=true`：
- 在 `document` 上注册 **mousedown capture** 事件监听
- 检测到点击发生在 dialog 外部时调用 `event.preventDefault()`
- 导致外部元素的后续 click 事件不触发

**副作用**：`modal=false` 时 `RadixDialog.Overlay` 内部检查 `context.modal`，直接返回 `null`，背景遮罩消失，背景元素变为可点。

## 避免方式

**诊断（5 秒）**：打开 DevTools，检查 `<body>` 下是否有：
```html
<span data-radix-focus-guard ...></span>
```
有此元素 → 根因是 FocusScope trap，直接排除 z-index 方向。

**修复方案**：对需要允许外部交互的 Dialog 设置 `modal={false}`，并在 `DialogContent` 中手动补自定义背景层（因为 Radix Overlay 在 modal=false 时不渲染）：

```tsx
// DialogContent 内部
{modal ? (
  <DialogOverlay />
) : (
  <div className="fixed inset-0 z-50 bg-background-mask" />
)}
```

在 `openXxxDialog` 的 options 里加 `modal: false`，通过 `buildShellOptions` → `ModalShellOptions` → `ModalHost` 完整链路传递。

**注意**：`buildShellOptions` 需要显式转发 `modal` 字段，否则链路断开，`data-radix-focus-guard` 仍然存在。
