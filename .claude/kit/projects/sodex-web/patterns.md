# sodex-web 模式规范

> L1 查阅文件 — `/k:ui` 读取
> ⚠️ sodex-web 的模式规范较基础,随业务补充。

## §responsive 响应式

- **断点**: 仅 `mobile:` / `pc:` 两个前缀(详见 tokens.md)
- **策略**: 按设计稿实际情况决定 PC-first 或 Mobile-first;无强制规则
- **布局切换**:
  - 大多数场景用 CSS 变体(`mobile:flex-col pc:flex-row`)
  - 复杂结构差异使用 `useIsMobileScreen()` hook(位置参考业务代码)

## §modal 弹窗

sodex-web 的弹窗体系未统一到 Shell 层(对比 sodex-next 的 modalManager)。规则:

- 业务模块自行管理弹窗状态(`useState` + 条件渲染)
- 新增弹窗时参考同 feature 的既有实现,保持一致
- 涉及钱包签名的小按钮场景,可启用 `showWalletConnectSigningModal` 避免空间不足

## §naming 子组件命名

- 无强制规则;参考 feature 内既有命名风格
- PC/Mobile 有明显结构差异时,可拆分为 `{Name}Pc.tsx` / `{Name}Mobile.tsx`(顺序与 sodex-next 相反,尊重既有习惯)

## §directory 目录结构

- **modules**: `src/modules/<domain>/` (trade / staking / vault 等)
- **通用 components**: `src/components/`
- **hooks**: `src/hooks/`
- **utils**: `src/utils/`
- **MobX stores**: 集中在 `src/stores/` 或模块内部

## §event-driven 事件驱动

跨系统事件(eventBus / 自定义事件 / 回调)必须检查:

1. **跨系统干扰**:该事件是否会被其他系统误触发(如 WS 推送 + 轮询同时 emit)
2. **同系统内干扰**:同来源不同操作类型是否都会触发;payload 是否能区分
3. **接收端状态覆盖**:同一组件是否监听多个事件且写入同一 state;事件 A 设置的 state 是否会被事件 B 覆盖

详见 `rules/event-driven.md`。

## §precision 精度计算

详见 `rules/precision-calculation.md`。核心:

- 比较 / 运算 / 格式化用 `calculate` + `floorToDecimal`,禁止 `parseFloat` + `toFixed`
- MobX 依赖传具体字段,不传整体对象引用
- 滑点容差判断用 `diff.lte("0.0001")` 模式
- 区分 `DEFAULT_DECIMAL`(UI)和 `TOKEN_DECIMAL`(链上)
