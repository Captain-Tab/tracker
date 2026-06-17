---
description: UI 迁移（Phase 1 精简版）：figma 还原 → props 化 → 落地 features/，供 /k:migration 对接
---

# UI Migration: Figma → 可迁移骨架

## 用户输入

```text
$ARGUMENTS
```

参数格式：`<功能名> --figma <url> --target <feature路径> [--modal] [--legacy <path>]`

示例：
- `/k:ui-migration fundWallet --figma https://figma.com/... --target src/features/fundWallet`
- `/k:ui-migration fundWalletDialog --figma https://figma.com/... --target src/features/fundWallet --modal`
- `/k:ui-migration activityTab --figma https://figma.com/... --target src/features/vault --legacy /path/to/old-project/src/pages/vault/tabs/Activity.tsx`

---

## 核心定位（Phase 1 范围）

**只做三件事，不做其他**：

1. 调 `/k:figma` 还原设计稿为 JSX
2. 把 JSX 改造成 **props-driven**（加 TypeScript interface）
3. 落地到 `<target>/components/`，供 `/k:migration` 在 Page 层组装

**Phase 1 不做**：
- ❌ styles.snapshot 指纹校验
- ❌ state-hints AI 扫描
- ❌ 独立 props-contract.ts 文件
- ❌ class 漂移检测
- ❌ verify 阶段对比

这些延后到 Phase 2，根据真实痛点再加。

---

## 前置检查

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 1. 解析参数
FEATURE_NAME=$(echo "$ARGUMENTS" | awk '{print $1}')
FIGMA_URL=$(echo "$ARGUMENTS" | grep -oP '(?<=--figma )\S+')
TARGET=$(echo "$ARGUMENTS" | grep -oP '(?<=--target )\S+')
IS_MODAL=$(echo "$ARGUMENTS" | grep -q -- '--modal' && echo "true" || echo "false")
LEGACY_PATH=$(echo "$ARGUMENTS" | grep -oP '(?<=--legacy )\S+')

# 2. 校验
[ -z "$FEATURE_NAME" ] && { echo "❌ 缺少功能名"; exit 1; }
[ -z "$FIGMA_URL" ] && { echo "❌ 缺少 --figma URL"; exit 1; }
[ -z "$TARGET" ] && { echo "❌ 缺少 --target 路径"; exit 1; }
```

---

## Step 0.5: 旧项目代码对照(迁移/重构场景必做)

> 核心目的:从旧代码提取**结构/行为真相**,避免仅看 Figma 自创布局导致反复返工。
> **token 优化**:分阶段加载,最大限度减少读取量。

### 0.5.1 定位旧代码(明示化,必须用户确认)

按优先级尝试:

1. **显式参数** `--legacy <path>` → 直接使用
2. **自动探测** 若未传:
   - 扫 `kit/context/library/*/reference/<FEATURE_NAME>/*`
   - 扫 sibling 老项目目录(如 `../sodex-web-update/src/**/<FEATURE_NAME>*`)
   - 按 target 路径推断:`src/features/vault/x` → 老项目 `pages/vault/x`
3. **皆失败** → 输出 ⚠️ 警告:`未找到旧代码,按新功能处理。如为迁移场景请补 --legacy 参数`,等用户确认

**命中后强制明示**,不隐式继续:

```
📍 匹配到旧项目主文件:
  - <path>(YYY 行,~ZZZ token)
  关联文件(按 import 追溯,可选读):
  - <path2> / <path3>

请确认: (y 继续 / n 改路径 / skip 视为新功能)
```

### 0.5.2 轻量扫描(Phase 1,不读全文)

命中后先用 grep 提取**信号**,不立即全文读:

```bash
LEGACY_SIGNALS=".claude/kit/ui-migration/${FEATURE_NAME}/legacy-signals.txt"

{
  echo "## 结构信号"
  grep -nE 'Columns|columns *=|columns *:' "$LEGACY_PATH"
  echo ""
  echo "## 响应式信号"
  grep -nE 'isMobileScreen|mobile:|useMediaQuery|MFlexTable|MTable' "$LEGACY_PATH"
  echo ""
  echo "## 样式钩子"
  grep -nE 'whitespace-nowrap|w-fit|shrink-0|minWidth|hideLabel|isFlatBottom|sortKey' "$LEGACY_PATH"
  echo ""
  echo "## 状态态"
  grep -nE 'loading|empty|isError|min-h-\[' "$LEGACY_PATH"
  echo ""
  echo "## 交互信号(弹窗/下拉/可折叠/输入 trigger)"
  grep -nE 'onClick|onChange|onToggle|onSubmit|onOpenChange|setIsOpen|setShow|setExpanded|setIsExpanded|Dropdown|<Menu|<Select|<Collapse|<Popover|<Modal|<Dialog|<Drawer|openModal|openDrawer|openResponsive|open=\{|expanded=\{|useState.*Open|useState.*Expanded' "$LEGACY_PATH"
  echo ""
  echo "## 初始化信号(默认值 / auto-fill / skeleton 触发)"
  grep -nE 'useState\(|useEffect.*(selectedChain|selectedAccount|selectedToken|token|chain)|autoFill|setValue\(|defaultChain|defaultToken|defaultValue|defaultFrom|defaultAccount|initialValue|isNewUser|customMinimum|isLoading|isPending' "$LEGACY_PATH" | head -40
  echo ""
  echo "## i18n / 文案"
  grep -nE 'i18n\.t\(|t\(' "$LEGACY_PATH" | head -20
} > "$LEGACY_SIGNALS"
```

输出 signals(通常 <50 行)供模型判断:**是否需要精读**。

### 0.5.3 判断是否需要精读(按需加载)

若 signals 中:
- 命中"响应式信号" + "结构信号"(列表/表格类)→ **必须精读**相关 section
- 命中"交互信号" 且含 `Modal/Dialog/Drawer/Dropdown/Menu/Select/Collapse/Popover` 或 `useState.*Open|Expanded` → **必须精读** trigger + state 逻辑,产出交互语义表(见 0.5.4)
- 命中"初始化信号" 且目标是弹窗/表单组件(mount 时立刻要出默认值)→ **必须精读** useState 默认值 + 所有 `useEffect(() => { if (!xxx) setXxx(...) }, [...])` 初始化分支,产出初始化规则表(见 0.5.4)
- 仅命中"样式钩子" → 精读 + 记录钩子位置
- 空 / 仅普通渲染 → 跳过精读,signals 本身即足够

> **交互信号精读要点**:对每个 chevron / icon button / switch / tab 等视觉元素,**必须**追溯老代码里它的 trigger 行为(state toggle / open modal / navigate / dropdown open)。Figma 静态外观不足以判断交互语义。

精读时**按 section 切片**,不吃全文:

```bash
# 示例:按"columns = [" 到 "];" 切片
sed -n '/allColumns *= *\[/,/^];$/p' "$LEGACY_PATH" > slice-columns.tsx
sed -n '/allMobileColumns *= *\[/,/^];$/p' "$LEGACY_PATH" > slice-mobile-columns.tsx
sed -n '/return (/,/^[[:space:]]*)[[:space:]]*}/p' "$LEGACY_PATH" > slice-jsx.tsx
```

### 0.5.4 产出结构化 legacy-notes(填表式,限幅)

写入 `.claude/kit/ui-migration/<功能名>/legacy-notes.md`,**严格遵守模板**(不自由发挥):

```md
# Legacy Notes: <功能名>

## 来源
- 主文件: <path>
- 关联文件(若有): <path2>

## 结构(列表/表格场景必填)

### PC
| id | header | minWidth | nowrap | 特殊 |
|----|--------|----------|--------|------|
| time | Time | 180 | ✗ | - |

### Mobile (仅列出与 PC 的差异)
| id | 变化 |
|----|------|
| amount | 拆成 amount + usd 两列 |

## 响应式切换
- 方式: `ui.isMobileScreen ? MFlexTable : FlexTable`
- Mobile 摘要列数: 3
- Mobile 展开策略: extra 列 / isFlatBottom(Coin)

## 样式钩子(位置 + 理由)
- whitespace-nowrap: <行号或位置> - <为何>
- w-fit: <...>

## 交互语义(弹窗/下拉/折叠/输入类必填,信号命中才有)

> 对 Figma 静态图里的每个 chevron / 图标按钮 / switch / tab / 可点击 row,
> 必须追溯老代码的 trigger → 判定它是 toggle / dropdown / modal / navigate,
> 并给出新项目对应 shared 组件。

| 元素 | Figma 外观 | 老代码行为(文件:行) | 新项目建议组件 |
|------|----------|-------------------|-------------|
| 举例: Network chevron | 向下箭头 row | index.tsx:L420 `<Dropdown open={...}>` 受控 | `shared/Dropdown` + open state,chevron rotate-180 |
| 举例: Must to know | warning Alert + chevron | L621 `setIsMustKnowExpanded` toggle + `<Collapse>` | `shared/Alert` + `shared/Collapse` + 受控 state |

## 初始化规则(弹窗/表单 mount 时的默认值 + auto-fill,信号命中才有)

> Figma 只画"某态快照",打开弹窗那一刻的默认值/auto-fill 规则在老代码里。
> 不补齐 → 新项目打开弹窗像素对齐,但业务态全空(比如 "Select coin" 不默认)。

| 字段 | 默认值来源(老代码:行) | 依赖 | Auto-fill / reset 规则 |
|---|---|---|---|
| 举例: selectedChain | L407-413 `isNewUser ? BASE_ETH : VALUE_CHAIN` | isNewUser | 初次 mount + isNewUser 变化时 |
| 举例: defaultToken | L63 `defaultToken = IN_COIN_SYMBOL`(MAG7) | props.defaultToken | mount 时 |
| 举例: amount(Max) | L245 `autoFillAmount(maxBalance)` | chain/token/from 变化 | chain/token/from 切换时 **且** `tradingStatus === 'idle'` |
| 举例: selectedAccount(ValueChain) | L321 `getBestAccountForToken`:余额最大 or 新用户→EVM-Funding | token/userId | token 切换时 |
| 举例: Skeleton 显示 | L854 `isLoading` = balance/token/nav 任一 loading | 多个 query | 所有 query resolved 前保持 true |

**防互相覆盖**(history 20260306):所有 auto-fill `useEffect` 必须带守卫:
- `tradingStatus !== 'idle' → return`(流程开始后不再 auto-fill)
- `userHasEdited` ref → return(用户手动输入过,不覆盖)

## 边界 / 状态
- 空态: <class 或占位>
- 正负颜色: + → status-up / - → status-down
- 分页: <信息>

## 与 Figma 的潜在冲突
- <字段> : Figma 看到 X,旧代码是 Y → 暂定 <按旧/按 figma>,需用户仲裁
```

**限幅**:notes 不超过 80 行,超出时丢弃无关信息(如业务计算细节)。

### 0.5.5 缓存复用

```bash
LEGACY_NOTES=".claude/kit/ui-migration/${FEATURE_NAME}/legacy-notes.md"
if [ -f "$LEGACY_NOTES" ] && [ "$LEGACY_NOTES" -nt "$LEGACY_PATH" ]; then
  echo "♻️ 复用既有 legacy-notes(旧代码未更新)"
  SKIP_LEGACY_READ=true
fi
```

---

## Step 1: Figma 还原（调用 /k:figma）

按 `/k:figma` 流程还原设计稿，**先只产出原始 JSX**，暂存到：

```
.claude/kit/ui-migration/<功能名>/raw.tsx
```

此阶段严格遵循：
- `.claude/rules/figma-style-mapping.md`（颜色/变量映射）
- `.claude/rules/use-shared-ui.md`（禁用原生 `<button>` 等，替换 shared/ui 组件）

**硬约束**：raw.tsx 内禁止出现：
- `useState` / `useEffect` / `useRef` / `useXxx`（hook 调用）
- `fetch` / `axios` / `import` store 或 service
- 任何副作用

如出现 → 还原阶段就要剥离，只留静态 JSX + 占位值。

---

## Step 2: Props 化改造

### 2.0 加载 few-shot 示例（风格锚点）

按组件类型加载对应示例作为参考风格（比读规则文档省 token 且更准确）：

| 判定条件 | 加载文件 |
|---|---|
| `--modal` flag 或组件名以 Dialog/Drawer/Modal 结尾 | `.claude/kit/ui-migration/examples/dialog.example.tsx` |
| 含事件回调 + 条件渲染（表单类） | `.claude/kit/ui-migration/examples/form.example.tsx` |
| 其他（纯展示类） | `.claude/kit/ui-migration/examples/panel.example.tsx` |

提示模型：**按示例组件的风格产出目标组件**（interface 形态、事件命名、className 风格、导出结构），规则已隐式体现在示例中，**不需要再加载 .claude/rules/**。

示例库使用规范见 `.claude/kit/ui-migration/examples/README.md`。

---

### 2.0.5 对照 legacy-notes(存在时强制)

若 `.claude/kit/ui-migration/<功能名>/legacy-notes.md` 存在:
- **必须**读取,作为结构/行为参考
- 表格/列表场景:PC 与 Mobile 列定义按 notes 拆分,**不自创布局**
- 样式钩子(`whitespace-nowrap` / `w-fit` / `isFlatBottom` 等)**逐条保留或等价实现**
- 发现 notes 与 figma 冲突时 → 执行 **2.0.6 冲突裁决**,不静默处理

### 2.0.6 冲突裁决(硬中断)

若 figma 与 legacy-notes 任一项不一致,改造**暂停**,在响应开头输出:

```md
⚠️ Figma ↔ Legacy 冲突,需确认:

| 位置 | Figma | Legacy | 当前选择 | 备注 |
|---|---|---|---|---|
| <XX> | <描述> | <描述> | 按 Legacy(默认) | <原因> |

回复:y 按默认继续 / 指定 override(如:amount 按 figma)
```

默认裁决规则:**旧代码优先**(保留已验证行为),但必须显式列出让用户确认。

---

读 `raw.tsx`，执行以下机械改造：

### 2.1 识别 slot（简单规则，不调模型）

| 模式 | 改造 |
|---|---|
| 数字/货币字面量 | 替换为 `{propName}` |
| 事件处理器占位（`onClick={() => {}}`） | 提取为 `onXxx` prop |
| 可选渲染块（设计稿含 error/empty 态） | 包 `{condition && ...}` |
| 列表重复结构 | `{items.map(...)}` |

**歧义场景**（如"Balance"是 i18n 还是写死）：**保持原值，不抽 props**。Phase 1 不追求全抽，留给后续迭代补。

### 2.2 生成 TypeScript interface

在组件文件顶部内嵌（不单独建文件）：

```tsx
export interface FundWalletPanelProps {
  balance: string;
  canSubmit: boolean;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
  errorText?: string;
}

export function FundWalletPanel(props: FundWalletPanelProps) {
  const { balance, canSubmit, onAmountChange, onSubmit, errorText } = props;
  return (/* JSX */);
}
```

**命名约定**：
- 事件 prop 用 `onXxx`（与 migration 的 ViewModel 返回值对齐）
- 数据 prop 用具体业务名（`balance` 不叫 `value`）

### 2.3 弹窗壳层剥离（仅 `--modal` 时）

若 `IS_MODAL=true`，按 `.claude/rules/modal-component-style.md` 剥离：

- 移除 JSX 根节点的 `p-*` / `border` / `rounded-*` / `bg-bg-black-*`（外层壳样式）
- 移除标题栏 + 关闭按钮节点（由 Shell 提供）
- 组件根元素改为 `w-full`
- 在同文件末尾**预生成 open 方法骨架**：

```tsx
export function openFundWalletDialog(/* 参数待 migration 补 */) {
  return openResponsive({
    title: '充值',
    // description: '...',
    content: (ctx) => <FundWalletDialog {...ctx} {/* props 待 migration 注入 */} />,
  });
}
```

标题先写占位，`/k:migration` 的 execute 阶段按 spec 补真实文案（i18n key）。

---

## Step 3: 落地

改造后的组件直接写入：

```
<target>/components/<ComponentName>/index.tsx
```

**落地前校验**（机械检查，不调模型）：

```bash
# 1. 禁用原生标签（use-shared-ui 红线）
grep -nE '<(button|input|select|dialog|table|hr|img)\b' "$OUTPUT_FILE" \
  && { echo "❌ 检测到原生标签未替换"; exit 1; }

# 2. 禁用 dark: 前缀（CSS Variables 约束）
grep -n 'dark:' "$OUTPUT_FILE" \
  && { echo "❌ 禁止使用 Tailwind dark: 前缀"; exit 1; }

# 3. 禁用 hook 调用
grep -nE '\buse[A-Z]\w+\s*\(' "$OUTPUT_FILE" \
  && { echo "❌ 组件内不应出现 hook 调用"; exit 1; }

# 4. 禁用 store/service import
grep -nE "from ['\"].*(/stores/|/services/|/infra/)" "$OUTPUT_FILE" \
  && { echo "❌ UI 组件禁止 import stores/services/infra"; exit 1; }
```

任一失败 → 回到 Step 2 修正后重新落地。

### 3.5 理解度自检(存在 legacy-notes 时)

落地后、输出交接前,模型必须输出**对齐表**证明理解正确:

```md
## 理解度自检

| 维度 | Legacy | 新实现 | 对齐 |
|---|---|---|---|
| 列数(PC) | 6 | 6 | ✅ |
| 列数(Mobile) | 3 摘要 + 4 extra | 3 摘要 + 4 extra | ✅ |
| whitespace-nowrap 位置 | 4 处 | 4 处 | ✅ |
| w-fit 位置 | 1 处(USD badge) | 1 处 | ✅ |
| i18n 策略 | i18n.t() | 硬编码 | ⚠️ 差异(新项目暂未接 i18n) |
| 空态容器 min-h | 400px | 40 | ⚠️ 差异 |
| **交互: Network chevron** | Dropdown 受控 open | `<button>` 单次 toggle | ⚠️ 差异(语义错) |
| **交互: Must to know** | setIsExpanded toggle + Collapse | state + Collapse ✅ 旋转 | ✅ |
| **初始化: 默认 Chain** | isNewUser ? BASE : VALUE | 硬编码 BASE_ETH | ⚠️ 差异(新用户 OK,老用户错) |
| **初始化: 默认 Token** | defaultToken = MAG7 | null(显示 "Select coin") | ⚠️ 差异 |
| **初始化: Auto-fill Max** | useEffect 按 chain/token/from 触发 autoFillAmount | 只有手点 Max 按钮 | ⚠️ 差异 |
| **初始化: Skeleton isLoading** | balance/token/nav 任一 loading 触发 | 硬编码 false | ⚠️ 差异 |
| **Loading 语义(新架构盲区)** | MobX observer 全量拉,挂载一次 loading | wagmi `useReadContract` 按参数 refetch,每次切 token/chain `isLoading=true` 反复 | ⚠️ 需 `hasLoadedOnceRef` 或类似 flag 拦截 refetch loading,Skeleton 不再重开 |
```

> **交互列 + 初始化列 都必填**:legacy-notes 的对应表格里每一行都要在此比对。
> 差异 → 悬挂问题,不要静默当"视觉相近就行"。
>
> **Loading 语义盲区说明**:此条和其他"对照老代码"的行不同,它抓的是**新项目按参数 query 引入的新 bug**(老代码没这个问题,grep 抓不到)。放自检表而非 Step 0.5 grep,因为只有实现完成后才能观察新代码 loading 行为。

### 3.6 迁移型 TODO / 占位清查(强制,落地前最后一步)

> 代码里写 `// TODO: 接入` 或 `"占位 0"` ≠ 完成。用户看不到注释,只看到错的 UI。
> 本步扫本轮新增/修改的代码,把**迁移型 TODO**(缺业务数据,非技术债)同步到 handoff.md。

```bash
# 扫本次 ui-migration 产出的目标文件(grep 迁移语义关键词)
grep -nE "占位|placeholder.*(TODO|temp|暂)|暂用|待接入|后续补|TODO: ?接入|TODO: ?接 [a-zA-Z]|TODO: ?外链|hardcode.*TODO|0x0000000000000000000000000000000000000000" \
  <target-files>
```

**判定规则**:

| 关键词 | 是否进 handoff | 说明 |
|---|---|---|
| `占位`/`placeholder`/`暂用`/`待接入`/`后续补` | ✅ 必进 | 缺业务数据或真实接线 |
| `TODO: 接入 XxxHook` | ✅ 必进 | 未接真实数据源 |
| `0x0000...0000`(mock address) | ✅ 必进 | 需真实 account/contract |
| `TODO: 性能`/`TODO: 重构`/`FIXME` | ❌ 技术债不进 | 正常注释即可 |

**落地**:每个迁移型 TODO 在 handoff.md 的"悬挂问题"段加一条:

```md
## 悬挂问题

- **<字段名>**: 当前 <占位方式>,待接入 <真实来源>。影响:<用户看到什么错>
  - 举例:Base 余额 Max=0,待接 `useReadContract(erc20.balanceOf)`。影响:Base 链用户打开 Max 显示 0。
```

**不落:grep 命中 ≥1 条 + handoff 没同步 → Step 3.5 自检不通过,必须先补 handoff 再交付**。

**任一 ⚠️** → 写入 `handoff.md` 的"悬挂问题"段,交给 `/k:migration execute` 阶段处理。

---

## Step 4: 输出交接信息

落地成功后输出（给用户 + 给 `/k:migration` 读）：

```
✅ UI 迁移完成

产物：
  - <target>/components/<ComponentName>/index.tsx
  - Props interface: <ComponentName>Props（已内嵌）

下一步：
  /k:migration execute <功能名>
  
  migration 需按 <ComponentName>Props 实现：
    - useXxxViewModel 返回值字段对齐 props
    - 在 <target>/pages/XxxPage.tsx 中 <Panel {...vm} /> 组装
    - 若为弹窗：补 openXxxDialog 的参数和 i18n key
```

同时追加一条记录到 `.claude/kit/ui-migration/<功能名>/handoff.md`：

```markdown
# UI 迁移交接

- 组件路径: <target>/components/<ComponentName>/index.tsx
- Props interface: <ComponentName>Props
- 弹窗场景: <true/false>
- Figma 来源: <url>
- 时间: <date>

## 已知未抽取的 slot（Phase 1 留白）
<列出 Step 2.1 歧义场景，供 migration 阶段人工判断>
```

---

## 与 /k:migration 的对接契约

| 阶段 | 行为 |
|---|---|
| `/k:migration plan` | 读 `components/<Name>/index.tsx` 的 `XxxProps` interface，生成 ViewModel 字段清单 |
| `/k:migration execute` | Container 层按 Props 写 `useXxxViewModel`；UI 子阶段只做 Page 组装（`<Panel {...vm} />`），**禁止修改 components 内部** |
| `/k:migration verify` | `tsc --noEmit` 保证 props 契约对齐（Phase 1 只做这一条校验） |

---

## Phase 1 硬约束总结

1. 不产出 `.raw.tsx` / `.adapted.tsx` 中间态——一步到位落到 `features/`
2. Props interface 内嵌组件文件，不单独建 `props-contract.ts`
3. 落地前 4 条 grep 校验（原生标签/dark 前缀/hook/禁 import）
4. 弹窗必须剥离壳层 + 预生成 `openXxxDialog`
5. 歧义 slot 保持原值不强抽，交给 migration 阶段补

---

## Token 预算

| 步骤 | 预估 | 说明 |
|---|---|---|
| Step 0.5 legacy 对照(迁移场景) | 500–2000 | 优化后:grep 信号 + 按 section 切片 + 结构化 notes,非全文吃 |
| Step 0.5 legacy 对照(新功能) | 0 | 无旧代码,跳过 |
| Step 0.5 二次调用同 feature | 0 | 命中 legacy-notes 缓存 |
| /k:figma 还原 | 3000–6000 | |
| Props 化改造 | 1500–3000 | |
| 落地 + 校验 + 自检 | 700–1200 | 自检表 +200 |
| **合计(迁移首次)** | **5700–12200** | |
| **合计(新功能 / 二次调用)** | **5200–10200** | |

对比完整方案（9000–21000）仍降低约 40–50%。Step 0.5 通过 grep 信号 + 切片读取 + 缓存复用三级优化,token 增量控制在 +10-20% 内,换取"可发现失败"和"一次性到位"的收益。
