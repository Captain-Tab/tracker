---
name: soso-responsive-modal-creation
description: 创建响应式弹窗（PC 端 Dialog + 移动端 Drawer）的标准流程。Use when creating modals, dialogs, drawers, popups, or responsive components that need to work on both desktop and mobile.
license: MIT
metadata:
  author: soso
  version: "1.0.0"
---

# 响应式弹窗创建指南

使用 `createResponsiveModal` 创建同时支持 PC 端和移动端的弹窗组件。

## When to Apply

- 需要创建新的弹窗/对话框/抽屉组件
- 弹窗需要同时适配 PC 端和移动端
- 使用 `createModal`、`createResponsiveModal`、`createSwipeAbleDrawer`
- 弹窗内部有表单/输入/状态管理

## How It Works

### 1. 创建弹窗组件

```tsx
// MyModal.tsx
import React, { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { type InjectModalProps } from "@/utils/modal/createModal";

interface Props extends InjectModalProps {
  // 外部传入的 props
  initialValue?: string;
  onSuccess?: () => void;
}

const MyModal: React.FC<Props> = (props) => {
  const { resolve, onClose, initialValue, onSuccess } = props;
  
  // ⚠️ 关键：状态初始化
  const [value, setValue] = useState(initialValue || "");
  
  // ⚠️ 关键：弹窗打开时重置状态（避免数据残留）
  useEffect(() => {
    setValue(initialValue || "");
  }, [initialValue]);
  
  const handleConfirm = async () => {
    // 业务逻辑...
    onSuccess?.();
    resolve?.(); // 关闭弹窗并 resolve Promise
  };
  
  return (
    <div>
      {/* 弹窗内容 */}
    </div>
  );
};

export default observer(MyModal);
```

### 2. 导出弹窗实例

```tsx
// modals/index.tsx
import { createResponsiveModal } from "@/utils/modal/createResponsiveModal";
import MyModal from "./MyModal";
import i18n from "@/i18n";

export const myModal = createResponsiveModal({
  Component: MyModal,
  options: {
    title: () => i18n.t("namespace:modal_title"),
    desc: () => i18n.t("namespace:modal_desc"),  // 可选
    classes: {
      root: "w-[420px]",  // PC 端宽度
    },
  },
});
```

### 3. 使用弹窗

```tsx
// 打开弹窗
myModal.open({ initialValue: "hello", onSuccess: handleSuccess });

// 打开并等待结果
const result = await myModal.open<ResultType>({ ... });

// 关闭弹窗
myModal.close();
```

## ⚠️ 状态重置问题（重要）

**问题**：NiceModal 可能复用组件实例，导致上次的状态残留。

**解决方案**：

### 方案 A：useEffect 重置（推荐）

```tsx
const [formData, setFormData] = useState(defaultValue);

// 每次 props 变化时重置状态
useEffect(() => {
  setFormData(defaultValue);
}, [defaultValue]);
```

### 方案 B：使用 key 强制重建

```tsx
// 在 open 时传入唯一 key
myModal.open({ key: Date.now(), ...props });

// 组件内部使用 key 触发重置
useEffect(() => {
  resetAllStates();
}, [props.key]);
```

### 方案 C：onClose 清理状态

```tsx
const handleClose = () => {
  // 清理状态
  setValue("");
  setError(null);
  onClose?.();
};
```

## Options 配置参考

```tsx
interface CreateResponsiveModalOptions {
  // 通用配置
  title?: string | (() => string);       // 标题
  desc?: string | (() => string);        // 描述
  icon?: React.ReactNode;                // 图标
  closable?: boolean;                    // 是否显示关闭按钮（默认 true）
  onClose?: () => void;                  // 关闭回调
  
  // 样式
  classes?: {
    root?: string;      // 弹窗容器
    paper?: string;     // Dialog paper
    closeIcon?: string; // 关闭按钮
    title?: string;     // 标题样式
    desc?: string;      // 描述样式
    header?: string;    // 头部样式
    container?: string; // 内容容器（移动端）
  };
  
  // PC 端特有
  hideBackdrop?: boolean;         // 隐藏背景遮罩
  onlyAllowCloseByManual?: boolean; // 只允许手动关闭
  transition?: any;               // 过渡动画组件
  
  // 移动端特有
  anchor?: "right" | "bottom";    // 抽屉方向
  HeaderComponent?: React.ReactNode; // 自定义头部
  onBack?: () => void;            // 返回按钮回调
  
  // 强制类型
  forceType?: "pc" | "mobile";    // 强制使用某种类型
}
```

## 常见模式

### 简单确认弹窗

```tsx
export const confirmModal = createResponsiveModal({
  Component: ConfirmDialog,
  options: {
    title: () => i18n.t("common:confirm"),
    classes: { root: "w-[400px]" },
  },
});
```

### 带表单的弹窗

```tsx
export const formModal = createResponsiveModal({
  Component: FormModal,
  options: {
    title: () => i18n.t("form:title"),
    desc: () => i18n.t("form:desc"),
    classes: { root: "w-[420px]" },
    onlyAllowCloseByManual: true, // 防止意外关闭
  },
});
```

### 仅移动端使用 Drawer

```tsx
import { createSwipeAbleDrawer } from "@/utils/modal/createMobileModal";

export const mobileDrawer = createSwipeAbleDrawer({
  Component: MobileContent,
  options: {
    title: "标题",
    anchor: "bottom",
  },
});
```

## 检查清单

创建弹窗时确认以下事项：

- [ ] 组件继承 `InjectModalProps` 类型
- [ ] 状态初始化使用 props 或默认值
- [ ] useEffect 监听关键 props 变化并重置状态
- [ ] 确认按钮调用 `resolve?.()` 关闭弹窗
- [ ] 错误状态在关闭时清理
- [ ] 异步操作有 loading 状态
- [ ] PC 端设置合适的宽度（`w-[400px]` 等）
- [ ] 移动端自动 100% 宽度，无需额外配置

## References

- `src/utils/modal/` - 弹窗工具库
- `src/pages/spot/main/position/tab/transferHistory/modals/` - 简单示例
- `references/code-examples.md` - 完整代码示例
- `references/state-reset-patterns.md` - 状态重置详解
- `scripts/generate-modal.sh` - 生成弹窗组件模板（用法：`bash generate-modal.sh <ModalName> <OutputPath>`）
- `scripts/check-modal.sh` - 验证弹窗组件是否符合规范（用法：`bash check-modal.sh <FilePath>`）

