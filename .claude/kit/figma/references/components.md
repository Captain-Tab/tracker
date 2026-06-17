# 组件库 Catalog

> 手动维护。新增或修改组件时更新此文件。
> AI 直接读取此文件匹配 Figma 节点，**不扫描组件库文件**。

**组件库路径**：`src/components/` 和 `src/components_tw/`

**匹配顺序**：图层名精确匹配 → 触发关键词匹配 → 结构特征匹配 → 降级原生 HTML

---

## 交互类

### Button

**触发关键词**：`btn` `button` `cta` `action` `submit`
**结构特征**：单个 FRAME + TEXT，无子 FRAME 嵌套

```tsx
<Button variant="primary" size="md">文字</Button>
<Button variant="outline" size="sm">文字</Button>
<Button variant="ghost">文字</Button>
```

**Props**：`variant(primary|outline|ghost|destructive)` `size(sm|md|lg)` `disabled` `loading` `onClick`

---

## 图标类

**图标库**：`@phosphor-icons/react`

节点名含以下关键词时，使用对应图标组件替代 IMAGE 节点：

| 关键词 | 图标组件 |
|--------|---------|
| `arrow-right` `→` | `ArrowRight` |
| `arrow-left` `←` | `ArrowLeft` |
| `chevron-right` `caret` | `CaretRight` |
| `chevron-down` | `CaretDown` |
| `close` `x` `dismiss` | `X` |
| `search` `搜索` | `MagnifyingGlass` |
| `menu` `hamburger` | `List` |
| `plus` `add` `+` | `Plus` |
| `check` `✓` | `Check` |
| `user` `profile` | `User` |
| `settings` `gear` | `Gear` |
| `copy` `复制` | `Copy` |
| `external` `link` `外链` | `ArrowSquareOut` |
| `warning` `⚠️` | `Warning` |
| `info` `ℹ️` | `Info` |
| `trash` `delete` `删除` | `Trash` |
| `edit` `pencil` `编辑` | `Pencil` |

```tsx
import { ArrowRight, X, MagnifyingGlass } from '@phosphor-icons/react'

<ArrowRight size={16} />
<ArrowRight size={24} weight="bold" />
```

---

## 弹窗类

### Modal / Dialog / Drawer

**触发关键词**：`modal` `dialog` `drawer` `popup` `sheet` `弹窗` `抽屉` `对话框`
**结构特征**：覆盖层 + 居中或底部 FRAME，有关闭按钮

> ⚠️ **特殊处理**：识别到弹窗类节点时，参考 `soso-responsive-modal-creation` skill：
> - PC 端 → Dialog
> - 移动端 → Drawer
> - 使用 `createResponsiveModal` 封装

```tsx
const MyModal = createResponsiveModal(MyContent)
·```
