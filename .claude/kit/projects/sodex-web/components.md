# sodex-web Shared UI 组件清单

> L1 查阅文件 — `/k:ui` 读取
> ⚠️ sodex-web 的 shared 组件体系尚不成熟,本清单随业务补充。新增组件时同步本文件。

## 现有常用组件(按需查阅源码)

sodex-web 组件分布较散,通用组件路径:

- **基础布局**: `src/components/`
- **业务模块**: `src/modules/<domain>/components/`
- **精度展示**: 使用 `calculate` + `floorToDecimal` 格式化数值(详见 `rules/precision-calculation.md`)

## 使用原则

1. **写 UI 代码前**:扫描当前 feature 目录和 `src/components/`,确认是否有可复用组件
2. **若组件存在但不完全匹配**:优先通过 props / 组合方式适配,而非自建
3. **若确实无匹配**:可使用原生标签(`<button>` / `<input>` / `<div>` 等)
4. **若多处需要同一个缺失组件**:提取到 `src/components/` 或对应 feature 的 components 目录

## 签名交互组件

涉及钱包签名时必须遵守 `rules/wallet-signing-detect.md`:

- 按钮 loading:`useWalletApproveText().wallet`
- 弹窗副标题:`useWalletApproveText().signature`
- 小按钮空间不足:启用 `showWalletConnectSigningModal: true`
- 签名失败 `cancel` 静默,`failed` / `error` 显示 toast

## 缺失组件流程

sodex-web 优先复用业务代码中已有模式,不强制建立完整 shared 组件库。若新 feature 需要跨模块使用某组件,提取到 `src/components/` 并在本文件追加。
