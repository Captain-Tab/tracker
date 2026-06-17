# 设计模式库

> 项目级 UI 模式，遇到重复设计结构时沉淀到这里。
> AI 在 Step 7 生成代码时，优先命中此文件中的模式。
>
> **当前状态**：已有 1 个模式。
> **如何添加**：还原设计稿时发现重复结构，按下方格式补充。

---

## 如何匹配

AI 按以下信号识别模式：

1. **图层名**：Figma 图层名含模式名称关键词
2. **结构特征**：节点类型组合（如 FRAME + IMAGE + TEXT + TEXT）
3. **截图视觉**：从截图中识别布局特征

命中模式后，直接使用模式代码，不重新推断。

---

## 模式列表

---

### PageWithBackgroundLayout

**触发关键词**：`page`、`background`、`主页面`、`页面容器`、`全屏背景`

**结构特征**：
- 全屏容器 + 固定背景图（PC 端）+ 居中内容区
- 三层结构：外层容器 → 背景层 → 内容层
- 移动端无背景图，PC 端显示全屏背景

**使用场景**：独立页面（如 Leaderboard、Stake、Campaign 等）

```tsx
import bgWebp from "@/assets/img/xxx/bg.webp";

const PageName: React.FC = () => {
  return (
    <div className="w-full min-h-screen bg-[#121212] font-sans relative overflow-hidden mobile:overflow-visible">
      {/* PC 端背景图 */}
      <div
        className="hidden pc:block fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `url(${bgWebp})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          zIndex: 0,
        }}
      />

      {/* 主内容区域 */}
      <div className="w-full mobile:pt-4 pc:w-[1000px] mx-auto px-4 pc:pt-8 pc:px-0 relative z-10 flex flex-col gap-4 pc:gap-3 pb-10">
        {/* 页面标题 */}
        <h1 className="text-2xl pc:text-[32px] font-bold text-white">
          {t("page_title")}
        </h1>

        {/* 页面内容 */}
        {children}
      </div>
    </div>
  );
};
```

**变量说明**：
| 变量 | 说明 | 可调整 |
|------|------|--------|
| `pc:w-[1000px]` | PC 端内容宽度 | 按设计稿调整 |
| `gap-4 pc:gap-3` | 内容间距 | 按设计稿调整 |
| `mobile:pt-4 pc:pt-8` | 顶部内边距 | 按设计稿调整 |
| `bgWebp` | 背景图路径 | 按页面替换 |

---

<!--
补充格式参考：

## [模式名称]

**触发关键词**：Figma 图层名包含的词
**结构特征**：节点类型 + 布局描述

```tsx
// 代码模板
```

---
-->
