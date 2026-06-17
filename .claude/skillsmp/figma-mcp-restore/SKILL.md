---
name: figma-mcp-restore
description: Restore Figma designs to React + Tailwind CSS code with high fidelity. Activates when user requests to restore figma, convert figma to code, generate component from figma design, or transform design to react.
license: MIT
metadata:
  author: soso
  version: "3.1.0"
---

# Figma MCP Restore Skill

## 概述

本 Skill 用于将 Figma 设计稿高还原度转换为 React + Tailwind CSS 代码。

### 核心能力

- **双 MCP 协作**：官方截图 + Framelink 数据
- 自动匹配项目组件库
- 设计令牌（颜色、间距、字体）精准转换
- 智能图片处理

### 技术方案

| 数据来源 | MCP | 用途 |
|---------|-----|------|
| 视觉参考 | 官方 `get_screenshot` | AI 能"看到"设计稿 |
| 结构数据 | Framelink `get_figma_data` | 精确数值，易于映射 |
| 图片导出 | Framelink `download_figma_images` | 导出图片资源 |

---

## 触发条件

当用户请求包含以下内容时激活：

- 提供 Figma URL（如 `figma.com/design/...`）
- 提供 fileKey 和 nodeId 参数
- 要求"还原设计稿"、"Figma 转代码"、"生成组件"

**关键词**：`还原`、`Figma`、`设计稿转代码`、`design to code`

---

## 前置条件

### 1. Framelink Figma MCP（必需）

用于获取结构化设计数据。

**配置方式**（mcp.json）：
```json
"Framelink Figma MCP": {
  "command": "npx",
  "args": [
    "-y",
    "figma-developer-mcp",
    "--figma-api-key=你的Token",
    "--stdio"
  ]
}
```

### 2. 官方 Figma MCP（推荐）

用于获取设计截图作为视觉参考。

**配置方式**（Cursor 设置）：
- 添加 Remote MCP：`https://mcp.figma.com/mcp`
- 通过 OAuth 授权 Figma 账号

---

## 执行流程

### Step 0: Token 感知（前置检查）

检测项目 tailwind.config 是否变更，决定使用缓存还是重新提取 Design Tokens：

```bash
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SKILL_DIR/scripts/sync-tailwind-tokens.sh"
```

**根据脚本输出处理**：

- 输出含 `✅ tailwind.config 无变更` → 使用已缓存的 `references/specification-project.md`（Step 4 统一读取），继续 Step 1
- 输出含 `🔄 tailwind.config 已变更` 或 `🆕 首次提取` → 按脚本指令提取 tokens，写入 `references/specification-project.md`，然后继续 Step 1
- 输出含 `⚠️ 未找到 tailwind.config` → 跳过，使用 `specification.md` 通用映射，继续 Step 1

> **映射优先级**：specification-project.md（项目专属）> specification.md（通用模板）

---

### Step 1: 解析 Figma URL

从用户提供的 URL 中提取参数：

```
URL: https://figma.com/design/{fileKey}/{fileName}?node-id={nodeId}

提取规则：
- fileKey: URL 路径中的文件标识
- nodeId: 将 URL 中的 `1-2` 转换为 `1:2` 格式
```

**示例**：
```
输入: https://figma.com/design/ABC123/Demo?node-id=1-2
提取: fileKey="ABC123", nodeId="1:2"
```

### Step 2: 获取设计数据

**2.1 获取截图（官方 MCP）**

调用 `user-Figma-get_screenshot` 获取视觉参考：

```
参数：
- fileKey: 文件 key
- nodeId: 节点 ID
```

> 截图让 AI 能"看到"设计稿，提高理解准确度。如果官方 MCP 不可用，跳过此步。

**2.2 获取结构数据（Framelink MCP）**

调用 `user-Framelink_Figma_MCP-get_figma_data` 获取数据：

```
参数：
- fileKey: 文件 key（必填）
- nodeId: 节点 ID（必填）
- depth: 遍历深度（可选）
```

**返回数据结构**：
```yaml
metadata:
  name: 文件名
  components: {}
  componentSets: {}

nodes:
  - id: '20169:122462'
    name: Frame Name
    type: FRAME
    layout: layout_XXXXX      # 引用 globalVars.styles
    children: [...]
    fills: fill_XXXXX         # 引用 globalVars.styles
    text: "文本内容"           # TEXT 节点
    textStyle: style_XXXXX    # 引用 globalVars.styles

globalVars:
  styles:
    layout_XXXXX:
      mode: row               # row | column
      alignItems: center
      gap: 12px               # 精确间距值
    fill_XXXXX:
      - '#5E5E5E'             # 颜色值
    style_XXXXX:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 12            # 精确字号
```

**2.3 错误处理**

如果 MCP 调用失败：
- 检查 fileKey/nodeId 格式
- 确认 API Token 有效
- 确认文件访问权限
- **报错退出，提示用户检查**

### Step 3: 图片处理与复杂度判断

**3.1 识别图片节点**

从返回数据中识别图片节点：
- `type: IMAGE` 的节点
- 有 `imageRef` 属性的节点
- 名称包含 `image`、`photo`、`icon`、`logo` 的节点

**3.2 判断是否需要用户确认**

统计以下指标：
- `IMAGE_COUNT`：图片节点数量
- `NODE_COUNT`：全部节点总数
- `MAX_DEPTH`：节点最大嵌套深度

```
有图片节点（IMAGE_COUNT > 0）
  → 必须询问图片处理方式
  → 同时展示结构树

无图片节点
  ├── NODE_COUNT ≤ 20 且 MAX_DEPTH ≤ 4
  │     → 直接进入 Step 4，跳过确认
  └── NODE_COUNT > 20 或 MAX_DEPTH > 4
        → 展示结构树，等用户确认
```

> **为什么是这两个阈值**：
> - 节点 > 20 通常意味着页面级设计，层级关系容易误读
> - 深度 > 4 意味着嵌套超过 4 层，AI 解析层级时出错率明显上升

**3.3 有图片 或 复杂设计时：展示结构树 + 询问**

```markdown
## 📋 请确认

### 结构树（仅在需要时展示）

根节点 (FRAME)
├── 子节点1 (TEXT) - "文本内容"
├── 子节点2 (IMAGE) - 需处理         ← 标注图片节点
└── 子节点3 (FRAME) → Button 组件

统计：节点 N 个 / 深度 N 层 / 图片 N 个

---

### 图片处理（有图片时必问）

检测到 N 个图片节点：
- 节点名称1 (nodeId: xxx)

请选择：
- a) 下载到指定目录（请提供路径）
- b) 使用占位符
- c) 跳过

---

结构是否正确？如有问题请指出。
```

**3.4 处理用户反馈**

- **结构有误** → 根据反馈调整理解，再次确认
- **选择 a** → 记录图片路径，后续统一导出
- **选择 b/c** → 跳过图片导出

**3.5 导出图片（如用户选择 a）**

调用 `user-Framelink_Figma_MCP-download_figma_images`：

```
参数：
- fileKey: 文件 key
- nodes: [{ nodeId: "xxx", fileName: "image-name.png" }]
- localPath: 用户指定的统一保存路径
- pngScale: 2（默认 2 倍图）
```

> **注意**：所有图片统一下载到用户指定的目录，生成代码时使用正确的引用路径。

### Step 4: 读取映射配置

一次性读取以下文件，后续步骤直接使用，不再重复读取：

```
.claude/rules/
└── figma-style-mapping.mdc    # Figma 变量名映射（单一数据源）⬅ 最高优先

.claude/skills/figma-mcp-restore/references/
├── specification-project.md   # 项目专属 Token（断点、渐变等）
├── specification.md           # 通用 Tailwind 映射（样式兜底）
├── components.md              # 组件 Catalog（Step 6 匹配用）
└── patterns.md                # 设计模式库（Step 7 优先命中）
```

**样式映射优先级**：
1. `.claude/rules/figma-style-mapping.md` — Figma 变量名 → Tailwind 类（单一数据源）
2. `specification-project.md` — 项目专属 Token（精确）
3. `specification.md` — 通用 Tailwind 映射（兜底）

**生成优先级**：
1. `patterns.md` 中有匹配模式 → 直接使用模式代码
2. `components.md` 中有匹配组件 → 使用组件
3. 无匹配 → 原生 HTML + Tailwind

### Step 5: 样式转换

根据映射规则，将 Figma 数据转换为 Tailwind 类：

**5.0 Figma 变量名替换（仅官方 MCP 需要）**

> ⚠️ **仅当使用官方 Figma MCP（`user-Figma-*`）时需要执行此步骤**
> 
> Framelink MCP 返回原始颜色值，不需要此转换。

官方 Figma MCP 可能返回 Figma 设计系统的变量名，必须替换：

```
检测模式：
- text-text-*     → 文字颜色变量
- bg-background-* → 背景颜色变量
- text-success-*  → 成功状态
- text-error-*    → 错误状态

替换规则（参考 .claude/rules/figma-style-mapping.md）：
- text-text-primary-*     → text-white
- text-text-secondary-*   → text-[#A3A3A3]
- bg-background-primary-* → bg-[#121212]
- bg-background-secondary-* → bg-[#1A1A1A]
- bg-background-tertiary-* → bg-[#262626]
- text-success-* / text-green-* → text-status-up
- text-error-* / text-red-* → text-status-down
```

> `*` 表示任意后缀（如 `-500`, `-(500-->-300)`），匹配时忽略后缀

**5.1 颜色转换（三层策略）**

```
1. 精确匹配：颜色值完全相同
2. 近似匹配：RGB 差值 < 30，选最接近的
3. 任意值兜底：无匹配时用 bg-[#5E5E5E]
```

**5.2 间距转换**

```yaml
# Framelink 返回
gap: 12px

# 映射规则（specification.md）
11-18 → gap-4

# 输出
gap-3  # 12px 最接近 gap-3 (12px)
```

**5.3 字体转换**

```yaml
# Framelink 返回
fontFamily: Inter
fontWeight: 400
fontSize: 12

# 映射规则
fontSize 12 → text-xs
fontWeight 400 → font-normal

# 输出
text-xs font-normal
```

**5.4 布局转换**

```yaml
# Framelink 返回
mode: row
alignItems: center
gap: 12px

# 输出
flex items-center gap-3
```

### Step 6: 匹配项目组件

Step 4 已读取 `references/components.md`（组件 Catalog），直接在其中匹配每个 Figma 节点：

**匹配顺序**：
1. Figma 图层名与 catalog 组件名相同 → 精确匹配
2. 图层名含 catalog 中的触发关键词 → 关键词匹配
3. 节点结构符合 catalog 中的结构特征 → 结构匹配
4. 无匹配 → 原生 HTML + Tailwind

> **不扫描组件库文件**。如发现 catalog 缺少项目中实际存在的组件，
> 在生成代码后提示用户补充：`💡 建议将 [组件名] 添加到 components.md`

### Step 7: 生成代码

**7.1 读取代码规范**

- `references/base.md` - 代码风格
- `references/specification.md` - 样式映射

**7.2 生成 TSX 代码**

对每个节点按优先级生成：

```
检查 patterns.md 模式列表（"暂无"则跳过）
  ↓ 命中 → 直接使用模式代码
  ↓ 未命中
检查 components.md 组件 Catalog
  ↓ 命中 → 使用组件
  ↓ 未命中
原生 HTML + Tailwind
```

结合：
- 截图（视觉参考）
- 结构数据（精确数值）
- 映射规则（标准化）
- 项目组件（复用）

**7.3 响应式处理**

```tsx
// 移动端：基础样式
// PC 端：md: 前缀
<div className="flex flex-col gap-4 md:flex-row md:gap-8">
```

> 💡 **弹窗/Dialog/Drawer 组件**：如果生成的节点是弹窗类组件，参考 `.claude/skills/soso-responsive-modal-creation/SKILL.md` 处理状态重置和 `createResponsiveModal` 封装。

### Step 8: 输出结果

**直接写入文件**（用户在最初已提供输出路径）。

输出内容：
- 完整组件代码（TSX）
- 必要的 import 语句
- Props interface（如有）

> 如果用户未提供输出路径，则在开始时询问，不在此步骤询问。

---

## MCP 工具参考

### 官方 Figma MCP

| 工具 | 用途 |
|-----|------|
| `user-Figma-get_screenshot` | 获取节点截图（视觉参考） |
| `user-Figma-get_design_context` | 获取设计上下文和代码 |
| `user-Figma-whoami` | 验证认证状态 |

> ⚠️ **注意**：官方 MCP 返回的代码可能包含 Figma 变量名（如 `text-text-secondary-(500-->-300)`），
> 必须根据 `.claude/rules/figma-style-mapping.md` 进行样式后处理替换。

### Framelink Figma MCP

| 工具 | 用途 |
|-----|------|
| `user-Framelink_Figma_MCP-get_figma_data` | 获取结构化设计数据 |
| `user-Framelink_Figma_MCP-download_figma_images` | 导出图片资源 |

### 参数速查

**get_figma_data**：
- `fileKey`: string（必填）
- `nodeId`: string（必填，格式 `1:2`）
- `depth`: number（可选）

**download_figma_images**：
- `fileKey`: string（必填）
- `nodes`: array（必填）- `[{ nodeId, fileName }]`
- `localPath`: string（必填）
- `pngScale`: number（可选，默认 2）

---

## 参考文件

| 文件 | 用途 | 加载时机 |
|-----|------|---------|
| `.claude/rules/figma-style-mapping.md` | Figma变量名 → Tailwind（单一数据源） | Step 4 统一读取 |
| `references/specification-project.md` | 项目专属 Token（渐变、阴影、间距） | Step 0 校验 / Step 4 读取 |
| `references/specification.md` | 通用 Tailwind 映射（兜底） | Step 4 统一读取 |
| `references/base.md` | 代码规范 | Step 4 统一读取 |
| `references/components.md` | 组件映射 | Step 6 匹配时 |

---

## 使用示例

### 示例 1: 完整交互流程

**用户输入**:
```
还原这个设计稿：
https://figma.com/design/ABC123/Demo?node-id=1-2

输出路径：src/components/Hero.tsx
```

**AI 执行流程**:

**Step 1-2**：获取截图和数据

**Step 3**：输出结构确认（等待用户确认）

```markdown
## 📋 设计稿结构分析

### 截图描述

这是一个 Hero 区域，包含标题、描述文字、CTA 按钮和主图。

### 结构树

Hero Section (FRAME)
├── Title (TEXT) - "欢迎使用" #1F2937
├── Description (TEXT) - 描述文字 #6B7280
├── CTA Button (FRAME) - 可匹配 Button 组件
└── Hero Image (IMAGE) - 需导出

### 布局

| 属性 | 值 | Tailwind |
|-----|-----|---------|
| 方向 | column | flex flex-col |
| 间距 | 24px | gap-6 |

### 统计

- 节点：4 个
- 图片：1 个
- 组件：Button

---

## 📋 请确认

### 1️⃣ 页面结构是否正确？

### 2️⃣ 图片处理

检测到 1 个图片节点：
- Hero Image (nodeId: 123:456)

请选择：
- a) 统一下载到指定目录
- b) 使用占位符
- c) 跳过图片

---

请回复确认，或指出需要修正的地方。
```

**用户回复**：
```
结构正确，图片下载到 public/images/hero/
```

**Step 4-8**：继续执行，生成代码并写入文件

### 示例 2: 用户修正结构

**AI 输出结构**:
```
1️⃣ 页面结构：
   ├─ Header (FRAME)
   └─ Content (FRAME)
```

**用户回复**：
```
结构有误，Header 里面还有 Logo 和 NavMenu 两个子组件
```

**AI 处理**：根据反馈重新分析，更新理解后继续

### 示例 3: 响应式（双设计稿）

**用户输入**:
```
PC 端：https://figma.com/design/ABC/Demo?node-id=1-2
移动端：https://figma.com/design/ABC/Demo?node-id=3-4

输出：src/components/NavBar.tsx
图片目录：public/images/nav/
```

**AI 执行**：
1. 分别获取两个设计稿的数据和截图
2. 输出两个结构对比，确认差异
3. 合并生成响应式代码

**生成代码**:
```tsx
export function NavBar() {
  return (
    <nav className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:gap-8 md:px-16">
      {/* 移动端垂直，PC 端水平 */}
    </nav>
  )
}
```

---

## 注意事项

### 用户需提供

1. **Figma URL**（必填）- 设计稿链接
2. **输出文件路径**（必填）- 如 `src/components/Hero.tsx`
3. **组件库路径**（可选）- 默认 `src/components/`
4. **图片保存路径**（可选）- 如需导出图片时提供

> **注意**：输出路径在开始时提供，流程结束直接写入，不再询问。

### 设计稿建议

1. 使用 **Auto Layout** - 避免绝对定位
2. **规范命名** - 如 `Button/Primary`
3. **组件化** - 重复元素使用 Component

### 已知限制

- 蒙版、混合模式可能无法完美还原
- 复杂动画/交互不支持
- 特殊字体需确保项目已安装

---

## 故障排查

### MCP 调用失败

1. **Framelink MCP**
   - 检查 API Token 是否有效
   - nodeId 格式必须是 `1:2`（冒号）

2. **官方 Figma MCP**
   - 检查 OAuth 授权状态
   - 调用 `user-Figma-whoami` 验证

### 样式不准确

1. **检查是否执行了样式后处理** — 确认 `.claude/rules/figma-style-mapping.md` 中的映射已应用
2. 检查生成的类名是否包含 Figma 变量名（如 `text-text-secondary-*`）
3. 检查 `specification.md` 映射规则
4. 补充缺失的颜色/间距映射到 `figma-style-mapping.mdc`
5. 对比截图调整

### 图片导出失败

1. 确认 localPath 目录存在
2. 检查节点是否为图片类型
3. 尝试降低 pngScale
