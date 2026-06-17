---
description: Figma 设计稿还原为 React + Tailwind CSS 代码
---

# Figma 还原: [组件/页面名称]

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

将 Figma 设计稿高还原度转换为 React + Tailwind CSS 代码。

**技术方案**：

| 数据来源 | MCP | 用途 |
|---------|-----|------|
| 视觉参考 | 官方 `get_screenshot` | AI 能"看到"设计稿 |
| 结构数据 | Framelink `get_figma_data` | 精确数值，易于映射 |
| 图片导出 | Framelink `download_figma_images` | 导出图片资源 |

---

## 前置条件

### 1. Framelink Figma MCP（必需）

```json
"Framelink Figma MCP": {
  "command": "npx",
  "args": ["-y", "figma-developer-mcp", "--figma-api-key=你的Token", "--stdio"]
}
```

### 2. 官方 Figma MCP（推荐）

Remote MCP：`https://mcp.figma.com/mcp`，通过 OAuth 授权。

---

## 用户需提供

1. **Figma URL**（必填）
2. **输出文件路径**（必填）- 如 `src/components/Hero.tsx`
3. **图片保存路径**（可选）- 如需导出图片

---

## 执行流程

### Step 0.0: 项目识别与规范加载（前置必读,v1.11.1+）

识别当前项目并加载项目级规范(L0 入口 + 硬约束)。

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$KIT_ROOT/.claude/kit/cli/identify.sh"

# 优先解析显式 --project 参数
EXPLICIT_PROJECT=$(echo "$ARGUMENTS" | grep -oE '\-\-project [a-zA-Z0-9_-]+' | awk '{print $2}')
if [[ -n "$EXPLICIT_PROJECT" ]]; then
    CURRENT_PROJECT="$EXPLICIT_PROJECT"
else
    CURRENT_PROJECT=$(identify_project "$(pwd)" 2>/dev/null || echo "")
fi

# 兜底 1:未识别 → 硬退出(强制先注册或显式 --project)
if [[ -z "$CURRENT_PROJECT" ]]; then
    echo "❌ 错误:无法识别当前项目" >&2
    echo "   请先注册项目(sosokit-add <name>)或显式指定 --project <name>" >&2
    echo "   已注册项目列表见 .claude/kit/projects.conf" >&2
    exit 1
fi

# 兜底 2:已识别但无 project 骨架 → 警告 + 回退到旧路径兜底(不退出)
PROJECT_DIR="$KIT_ROOT/.claude/kit/projects/$CURRENT_PROJECT"
if [[ -d "$PROJECT_DIR" ]]; then
    HAS_PROJECT_KIT=true
else
    echo "⚠️ kit/projects/$CURRENT_PROJECT/ 不存在(老项目未迁移),Step 4 将回退读 kit/figma/references/specification.md" >&2
    HAS_PROJECT_KIT=false
fi
```

**根据 HAS_PROJECT_KIT 处理**:

- **HAS_PROJECT_KIT=true**(v1.10.0+ 已迁移):
  1. **必读 L0**:`Read .claude/kit/projects/<CURRENT_PROJECT>/PROJECT.md`(PROJECT.md 内用 `@constraints.md` 自动引用约束文件)
  2. **按需加载提示**(Step 4 统一执行):Claude 根据 PROJECT.md 的"按需加载路由"决定 Step 4 读哪些子文件
- **HAS_PROJECT_KIT=false**(老项目未迁移):跳过 L0/L1 加载,Step 0 走 token 感知机制,Step 4 回退读 `kit/figma/references/specification.md`

---

### Step 0: Token 感知（前置检查）

检测项目 tailwind.config 是否变更，决定使用缓存还是重新提取 Design Tokens：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/figma/scripts/sync-tailwind-tokens.sh"
```

**根据脚本输出处理**：

- 输出含 `✅ tailwind.config 无变更` → 使用已缓存的 `references/specification-project.md`（Step 4 统一读取），继续 Step 1
- 输出含 `🔄 tailwind.config 已变更` 或 `🆕 首次提取` → 按脚本指令提取 tokens，写入 `references/specification-project.md`，然后继续 Step 1
- 输出含 `⚠️ 未找到 tailwind.config` → 跳过，使用 `specification.md` 通用映射，继续 Step 1

> **映射优先级**：specification-project.md（项目专属）> specification.md（通用模板）

---

### Step 1: 解析 Figma URL

从 URL 提取参数：

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

调用 `user-Figma-get_screenshot` 获取视觉参考。官方 MCP 不可用则跳过。

**2.2 获取结构数据（Framelink MCP）**

调用 `user-Framelink_Figma_MCP-get_figma_data`：

```
参数：
- fileKey: 文件 key（必填）
- nodeId: 节点 ID（必填）
- depth: 遍历深度（可选）
```

**返回数据结构**：
```yaml
nodes:
  - id: '20169:122462'
    name: Frame Name
    type: FRAME
    layout: layout_XXXXX      # 引用 globalVars.styles
    children: [...]
    fills: fill_XXXXX
    text: "文本内容"
    textStyle: style_XXXXX

globalVars:
  styles:
    layout_XXXXX:
      mode: row
      alignItems: center
      gap: 12px
    fill_XXXXX:
      - '#5E5E5E'
    style_XXXXX:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 12
```

**2.3 错误处理**

MCP 调用失败：检查 fileKey/nodeId 格式、API Token 有效性、文件访问权限，**报错退出**。

### Step 3: 图片处理与复杂度判断

**3.1 识别图片节点**：`type: IMAGE`、有 `imageRef`、名称含 `image/photo/icon/logo`

**3.2 判断是否需要用户确认**：

```
有图片节点（IMAGE_COUNT > 0）
  → 必须询问图片处理方式 + 展示结构树

无图片节点
  ├── NODE_COUNT ≤ 20 且 MAX_DEPTH ≤ 4 → 直接进入 Step 4
  └── NODE_COUNT > 20 或 MAX_DEPTH > 4 → 展示结构树等确认
```

**3.3 展示结构树 + 询问**：

```markdown
## 📋 请确认

### 结构树
根节点 (FRAME)
├── 子节点1 (TEXT) - "文本内容"
├── 子节点2 (IMAGE) - 需处理
└── 子节点3 (FRAME) → Button 组件

统计：节点 N 个 / 深度 N 层 / 图片 N 个

### 图片处理（有图片时必问）
- a) 下载到指定目录（请提供路径）
- b) 使用占位符
- c) 跳过
```

**3.4 导出图片（如用户选择 a）**：

```
user-Framelink_Figma_MCP-download_figma_images:
- fileKey
- nodes: [{ nodeId, fileName }]
- localPath
- pngScale: 2
```

### Step 4: 读取映射配置

按优先级读取:

```
.claude/kit/projects/<CURRENT_PROJECT>/              # 🆕 v1.10.0+ 项目级规范(最高优先)
├── figma-mapping.md           # Figma 变量/颜色/字体/断点映射
├── tokens.md                  # 完整 token 速查
└── style-checklist.md         # Step 9 自检读取

.claude/rules/figma-style-mapping.md                 # rules 级(项目已分发)
.claude/kit/figma/references/                        # 通用模版(兜底)
├── specification-project.md   # 项目专属 Token(旧机制)
├── specification.md           # 通用 Tailwind 映射
├── components.md              # 组件 Catalog(Step 6)
└── patterns.md                # 设计模式库(Step 7)
```

**样式映射优先级**:
1. **`kit/projects/<CURRENT_PROJECT>/figma-mapping.md` + `tokens.md`**(🆕 最高优先,v1.10.0+)
2. `.claude/rules/figma-style-mapping.md`(rules 级)
3. `specification-project.md`(旧机制)
4. `specification.md`(兜底)

> 若 Step 0.0 识别失败或目录不存在,跳过第 1 项,从第 2 项开始。

**生成优先级**：
1. `patterns.md` 命中 → 直接使用模式代码
2. `components.md` 命中 → 使用组件
3. 无匹配 → 原生 HTML + Tailwind

### Step 5: 样式转换

**5.0 Figma 变量名替换（仅官方 MCP 需要）**

> Framelink MCP 返回原始颜色值，跳过此步。

官方 Figma MCP 可能返回设计系统变量名，按 `.claude/rules/figma-style-mapping.md` 替换。

**5.1 颜色转换（三层策略）**：
1. 精确匹配
2. 近似匹配（RGB 差值 < 30）
3. 任意值兜底 `bg-[#xxxxxx]`

**5.2 间距/字体/布局**：按 `specification.md` 规则映射。

**5.3 弹窗内容组件（width/padding 特例）**

> ⚠️ 「忽略容器 width/height，由子元素撑开」对普通容器成立，**对弹窗错**——弹窗宽度是设计稿明确尺寸，不是子元素撑出来的。

识别为「弹窗内容组件」时（被 `openResponsive`/`openModal`/`openDrawer` 调用 / props 含 `ModalInjectedProps`）：

- **宽度**：读 Figma 弹窗 frame 的 `dimensions.width`，映射到 `open*` 的 `classes.content` 为 `w-{width/4}`（如 524 → `w-131`）。**禁止套用默认值或其它弹窗的宽度**。
- **壳层（跳过，shell 提供）**：frame 的 padding / 标题 / 关闭按钮 / border / rounded / bg —— 组件根只 `w-full`，不还原这些（见各项目 `patterns.md §modal`）。

**5.4 渐变描边（fill 渐变 + stroke 渐变）**

Figma 节点同时有 `fills`(GRADIENT_LINEAR) + `strokes`(GRADIENT_LINEAR) = 渐变填充 + 渐变描边。CSS 用 `background: <fill> padding-box, <border-gradient> border-box` + `border:1px solid transparent`。

> ⚠️ **fill 半透明时必须补一层不透明底**：Figma 的半透明 fill 是叠在深色父级上合成的；CSS 若直接用半透明 padding-box，border-box 渐变会**渗透整卡**（变成亮色实心）。正确是**三层**：`<半透明 fill> padding-box, <不透明父级底色> padding-box, <border 渐变> border-box`。项目有「渐变描边卡」模式时直接复用（见 `patterns.md`）。

**5.5 文本对齐**

按**文本节点自身**的 `textAlignHorizontal`（LEFT/CENTER/RIGHT）设 `text-left/center/right`，**禁止**用父容器的 `justifyContent` 推断（父 justify-center ≠ 文字居中）。

### Step 6: 匹配项目组件

从 `references/components.md` 中匹配：

1. 图层名精确匹配
2. 触发关键词匹配
3. 结构特征匹配
4. 无匹配 → 原生 HTML + Tailwind

> **不扫描组件库文件**。发现 catalog 缺失组件 → 提示 `💡 建议将 [组件名] 添加到 components.md`

### Step 7: 生成代码

**7.1 读取代码规范**：`base.md`、`specification.md`

**7.2 生成 TSX**：按优先级（patterns → components → 原生 HTML）

**7.3 响应式处理**：

```tsx
<div className="flex flex-col gap-4 md:flex-row md:gap-8">
```

> 💡 **弹窗/Dialog/Drawer**：参考 `.claude/skills/soso-responsive-modal-creation/SKILL.md` 处理状态重置和 `createResponsiveModal` 封装。

### Step 8: 输出结果

直接写入用户指定路径，包含：
- 完整组件代码（TSX）
- 必要 import
- Props interface（如有）

---

### Step 9: 自检(v1.10.0+)

代码生成完成后,读取项目级 checklist 按流程自检:

```
Read .claude/kit/projects/<CURRENT_PROJECT>/style-checklist.md
```

按 checklist 列出的"自检顺序"逐项核对(颜色 token / 边框背景分隔线圆角 / 间距圆角 / 组件用法 / 响应式 / 弹窗壳层 / 命名目录 / 开发范围)。

自检通过后,按 checklist 的"产出说明"段格式在本次回复末尾追加:

- **使用的 token 清单**:{逐条列出}
- **硬编码豁免(如有)**:{位置 + 原因 + 后续替换计划}
- **偏离项(如有)**:{与规范偏离的点 + 理由}

> 若 `kit/projects/<CURRENT_PROJECT>/style-checklist.md` 不存在,跳过此步。

---

## MCP 工具参考

### 官方 Figma MCP

| 工具 | 用途 |
|-----|------|
| `user-Figma-get_screenshot` | 节点截图 |
| `user-Figma-get_design_context` | 设计上下文和代码 |
| `user-Figma-whoami` | 验证认证 |

> ⚠️ 官方 MCP 可能返回 Figma 变量名（如 `text-text-secondary-(500-->-300)`），必须按 `figma-style-mapping.md` 替换。

### Framelink Figma MCP

| 工具 | 用途 |
|-----|------|
| `user-Framelink_Figma_MCP-get_figma_data` | 结构化数据 |
| `user-Framelink_Figma_MCP-download_figma_images` | 图片导出 |

---

## 注意事项

### 设计稿建议

1. 使用 **Auto Layout**
2. **规范命名**（如 `Button/Primary`）
3. **组件化**重复元素

### 已知限制

- 蒙版、混合模式可能无法完美还原
- 复杂动画/交互不支持
- 特殊字体需确保项目已安装

---

## 故障排查

### MCP 调用失败

- **Framelink**：API Token 有效性、nodeId 格式必须是 `1:2`
- **官方 Figma**：OAuth 授权状态、调用 `whoami` 验证

### 样式不准确

1. 确认 `figma-style-mapping.md` 映射已应用
2. 检查生成的类名是否残留 Figma 变量名（如 `text-text-secondary-*`）
3. 检查 `specification.md` 映射规则
4. 补充缺失映射到 `figma-style-mapping.md`

### 图片导出失败

1. 确认 localPath 存在
2. 检查节点是否图片类型
3. 尝试降低 pngScale
