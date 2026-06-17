# 基础规则

## 技术栈

- **框架**: React 18+
- **样式**: Tailwind CSS 3.x
- **语言**: TypeScript（优先）/ JavaScript
- **组件库**: 优先使用项目已有组件库

---

## 代码规范

### 文件命名

| 类型 | 格式 | 示例 |
|-----|------|------|
| 组件文件 | PascalCase | `HeroSection.tsx` |
| 工具函数 | camelCase | `formatDate.ts` |
| 目录名 | kebab-case | `hero-section/` |

### 组件结构

```tsx
interface Props {
  // 属性定义
}

export function ComponentName({ prop1, prop2 }: Props) {
  return (
    <div className="...">
      {/* 内容 */}
    </div>
  )
}
```

---

## Tailwind 使用规范

### 类名顺序

1. 布局（display, position）
2. 盒模型（width, height, padding, margin）
3. 排版（font, text）
4. 视觉（background, border, shadow）
5. 其他（transition, cursor）

### 响应式

```tsx
// 项目断点：mobile:（< 760px）和 pc:（≥ 760px），不使用 md:/lg:
<div className="w-full pc:w-1/2">
```

---

## 布局规则

优先级：
1. **Flexbox** - 一维布局
2. **Grid** - 二维布局
3. **Absolute** - 仅用于重叠元素

---

## 语义化 HTML

| 内容类型 | 标签 |
|---------|------|
| 页面头部 | `<header>` |
| 导航 | `<nav>` |
| 主要内容 | `<main>` |
| 独立区块 | `<section>` |
| 页面底部 | `<footer>` |

---

## 复杂度分级

| 等级 | 分数 | 策略 |
|-----|------|------|
| 简单 | 0-29 | 直接生成 |
| 中等 | 30-59 | 快速分析 |
| 复杂 | 60+ | 分块生成 |

---

## 错误处理

### MCP 调用失败

如果 Framelink MCP 调用失败：

1. **检查参数格式**：
   - fileKey 是否正确（字母数字组合）
   - nodeId 格式是否为 `数字:数字`（如 `1:2`）

2. **检查权限**：
   - 用户是否有权访问该 Figma 文件
   - 文件是否为私有文件

3. **报错退出**：
   ```
   ❌ Figma 数据获取失败
   
   请检查：
   - Figma URL 是否正确
   - 是否有权限访问该文件
   - Framelink MCP 是否已启用
   ```

4. **不继续执行**后续步骤

### 节点不存在

如果指定的 nodeId 不存在：
```
❌ 未找到节点 1:2
请检查 node-id 参数是否正确
```

---

## 输出规范

### 文件写入

1. 用户在开始时提供输出路径（如 `src/pages/Hero.tsx`）
2. 生成完整代码
3. 直接写入文件（不再询问）
4. 确认成功：`✅ 已生成 src/pages/Hero.tsx`

### 代码结构

```tsx
// 1. 导入语句
import { Component } from '@/components'
import { Icon } from '@phosphor-icons/react'

// 2. Props 接口（可选）
interface Props {
  title?: string
}

// 3. 组件定义
export function ComponentName({ title }: Props) {
  return (
    // 4. JSX 结构
  )
}
```
