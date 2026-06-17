# sodex-next 模式规范

> L1 查阅文件 — `/k:ui` 读取

## §responsive 响应式

开发有 PC + Mobile 双端 Figma 设计稿的页面时使用:

1. **PC-first**:先实现 PC 完整版本,再对照 Mobile 设计稿适配
2. **模式选择**:
   - **布局调整** → 用 CSS 变体(`mobile:` / `pc:`)
   - **结构差异** → 才用 `useIsMobileScreen()` hook
3. **复用现有组件**:
   - 表格用 `ResponsiveTable`
   - 弹窗用 `ModalHost` / `modalManager`
   - 禁止手动切换
4. **子组件拆分**:用 `Pc{Name}.tsx` / `Mobile{Name}.tsx`,私有文件不从 feature `index.ts` 导出
5. **数据不重复**:拆分 PC/Mobile 组件时,数据 hook 在父组件调用,通过 props 传入

## §modal 弹窗 / Drawer

### 判断条件

组件满足以下任一条件时视为「弹窗内容组件」:

1. 自身被 `openModal` / `openDrawer` / `openResponsive` / `enqueueModal` / `enqueueDrawer` / `enqueueResponsive` 调用
2. 上层组件(直接或间接父组件)被上述方法调用
3. props 包含 `ModalInjectedProps`(`resolve` / `reject` / `close` / `modalId`)

这些方法来自 `src/shared/infra/modalManager/api.ts`。

### 标准模式

每个弹窗组件文件必须导出两样东西:

1. **弹窗内容组件** — 只负责内容区渲染;需要 `close` / `resolve` 等注入方法时才接收 `ModalInjectedProps`
2. **打开弹窗的方法** — 封装 `openResponsive` / `openModal` / `openDrawer` 调用,将 `title`、`description`、`classes` 等 Shell 配置收敛在此

### 核心规则

- `openResponsive` / `openModal` / `openDrawer` **只能出现在弹窗组件文件内部**,禁止在业务调用方直接使用
- **标题(title)和描述(description)禁止写在组件 JSX 中**,必须通过 `open*` 方法的 `options` 传入
- 外部调用方只 import `open*` 方法,不直接引用弹窗内容组件
- 命名规则:`open` + 组件名(如 `FundWalletDialog` → `openFundWalletDialog`)
- **宽度 = Figma 弹窗 frame 的 `dimensions.width`**(如 524 → `classes:{content:"w-131"}`):弹窗宽度是设计稿明确尺寸,**不要套默认值或其它弹窗的宽度**;shell 提供 padding,故 `classes.content` 宽度直接对齐 frame 全宽

### 示例:无 props 弹窗

```tsx
// ConnectedDeposit.tsx
export function ConnectedDeposit({ resolve }: Partial<ModalInjectedProps>) {
  // 内容区渲染...
}

type OpenDepositProps = Pick<DepositProps, "token" | "chain">;

/** 打开 Deposit 弹窗 */
export function openConnectedDeposit(props?: OpenDepositProps): void {
  void openResponsive(ConnectedDeposit, props, {
    title: "Deposit",
    classes: { content: "w-137.5" },
  });
}
```

### 示例:带 props 弹窗

```tsx
// Tpsl/index.tsx
export function Tpsl({ positionSide, coin, resolve, ...rest }: TpslProps) {
  // 内容区渲染...
}

/** 打开 TP/SL 弹窗 */
export function openTpsl(
  props: Omit<TpslProps, keyof ModalInjectedProps>,
): void {
  void openResponsive(Tpsl, props, {
    title:
      props.positionSide === "LONG"
        ? "TP/SL for Long Position"
        : "TP/SL for Short Position",
  });
}
```

### 示例:openDrawer 抽屉

```tsx
// MobileMenuDrawer.tsx
export function openMobileMenuDrawer(): void {
  void openDrawer(
    MobileMenuDrawer,
    {},
    {
      showClose: false,
      direction: "right",
      classes: { content: "w-full bg-bg-black-primary-alt p-0" },
    },
  );
}

export function MobileMenuDrawer({ close }: ModalInjectedProps) {
  // 内容区渲染...
}
```

### 示例:需要 Promise 的弹窗(`.finally()` 等)

适用于 `openResponsive` / `openModal` / `openDrawer`,它们都返回 `Promise`。

```tsx
export function openLeverageSelector(
  props: Omit<LeverageSelectorProps, keyof ModalInjectedProps>,
): Promise<unknown> {
  return openResponsive(LeverageSelector, props, {
    title: "Adjust Leverage",
    description: "Control the leverage used for positions...",
    dedupeKey: "futures-orderform-leverage",
  });
}

// 调用方
openLeverageSelector({ ... }).finally(() => setLeverageOpen(false));
```

### 实操要点

- 对照 Figma 设计稿时,忽略最外层的弹窗壳(标题栏、关闭按钮、容器 padding/border/rounded/bg),只关注壳内的内容区
- 组件根元素用 `w-full` 即可,不加 `p-*`、`border`、`rounded-*`、`bg-bg-black-*` 等壳层样式
- 如果设计稿中内容区域内部有自己的 padding/border(如卡片、输入框),属于内容样式,正常添加

## §gradient-card 渐变描边卡

### 命中条件

Figma 节点同时含 `fills`(GRADIENT_LINEAR) + `strokes`(GRADIENT_LINEAR) = 渐变填充 + 渐变描边(常见于金色/高亮卡片)。

### 核心规则（必须三层 background）

渐变描边用 `background: <padding-box> ..., <border-box> ...` + `border:1px solid transparent` 实现。**当 fill 半透明时,border-box 渐变会渗透整卡(变亮色实心)** —— 因为 Figma 半透明 fill 是叠在深色父级上合成的,CSS 丢了这层不透明父级底。

修法:中间补一层**不透明父级底色**(`padding-box`),挡住 border-box 渐变,使金色只留在 1px 描边:

```
顶层: <半透明 fill 渐变>          padding-box
中层: <不透明父级底色(CSS var)>   padding-box   ← 关键,挡渗透
底层: <border 渐变>              border-box    ← 只在 1px 描边可见
```

### 示例(sodex-next 金卡,深色底用该卡所在父级的 bg var)

```ts
// 集中常量,弹窗/海报共用;深色底 var 取该卡所在父级背景(如 --background-bg-black-primary-alt)
const GRADIENT_CARD_CLASS =
  "[border:1px_solid_transparent] [background:linear-gradient(180deg,rgba(250,231,174,0.2)_0%,rgba(0,0,0,0)_100%)_padding-box,linear-gradient(var(--background-bg-black-primary-alt),var(--background-bg-black-primary-alt))_padding-box,linear-gradient(135deg,rgba(250,231,174,1)_0%,rgba(255,242,216,1)_49%,rgba(222,164,76,1)_98%)_border-box]";
```

> 截图场景(html-to-image)用内联 style 同款三层(`var()` 在 computed style 会解析);**`backgroundColor` 单独加无效** —— 它是最底层,挡不住 border-box,必须用中间的不透明 padding-box 层。

## §naming 子组件命名

- PC/Mobile 拆分:`Pc{Name}.tsx` / `Mobile{Name}.tsx`
- 私有文件不从 feature `index.ts` 导出
- 数据 hook 在父组件调用,通过 props 传入 PC/Mobile 子组件

## §directory 目录结构

### Feature 目录

- feature 位置: `src/features/<feature>/`
- domain: `src/features/<feature>/domain/`

### Domain Stories / Tests

为 domain 文件创建 Storybook 示例或测试时:

- **源文件**: `src/features/<feature>/domain/<name>.ts`
- **stories**: `src/features/<feature>/domain/stories/<name>/<name>.stories.tsx`
- **test**: `src/features/<feature>/domain/stories/<name>/<name>.test.ts`

禁止把这类文件放到 `src/domain/` 或其他跨 feature 目录,必须与对应 feature 的 domain 同级归档。

### Story 标题规范

- title 使用:`Domain/<Feature>/<name>.ts`
- `<Feature>` 使用首字母大写形式(例如 `trade` → `Trade`)

### 内容规范

- stories 展示纯函数输入输出示例,并优先包含 `play` 断言
- `.test.ts` 使用 vitest,覆盖核心路径与边界行为
- stories/test 中应 import 对应 domain 源文件,不复制业务实现
