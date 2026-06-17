# Feature Components 目录结构

## 适用范围

`src/features/<name>/components/` 目录。不适用于 `shared/components/`。

## 规则

Feature 内的 components 采用**扁平文件结构**：

```
components/
  index.tsx                  — 主入口组件（对外暴露的核心 UI）
  SubComponentA.tsx
  SubComponentB.tsx
  SomeModal.tsx
```

- `index.tsx` 是 feature 的主入口 UI 组件，承载核心渲染逻辑，同时 re-export 需要对外暴露的内容（如 open 方法）
- 其他组件作为同级文件，文件名即组件名（PascalCase）
- **禁止为单文件组件创建同名文件夹**（如 `ComponentA/index.tsx`）

## 何时允许建文件夹

组件需要多个私有子文件时（如拆分出 PC/Mobile 子组件、私有 hooks），才建文件夹：

```
components/
  index.tsx                         — 主入口组件
  SimpleComponent.tsx               — 单文件，不建文件夹
  ComplexComponent/                 — 多文件，建文件夹
    index.tsx
    PcComplexComponent.tsx
    MobileComplexComponent.tsx
```
