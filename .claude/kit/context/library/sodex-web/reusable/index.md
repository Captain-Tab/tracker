# 可复用资源清单

> plan 阶段通过 reusable-match.sh 按 tags 匹配，只返回相关区块。

<!-- tags: 金额,余额,价格,数量,精度,calculate,decimal,balance,amount,price -->
## 精度计算

| 场景 | ✅ 使用 | ❌ 禁止 | 路径 |
|------|--------|--------|------|
| 数值比较 | `calculate(a).gt(b)` | `parseFloat(a) > b` | `@/utils/calculate` |
| 数值运算 | `calculate(a).sub(b).done()` | `parseFloat(a) - b` | `@/utils/calculate` |
| 格式化显示 | `floorToDecimal(a, {decimal:4})` | `toFixed(4)` | `@/utils/decimals` |
| UI 显示精度 | `DEFAULT_DECIMAL = 4` | 硬编码 `4` | `constants` |
| 链上精度 | `TOKEN_DECIMAL = 8` | 用 DEFAULT_DECIMAL 截断链上金额 | `constants` |

<!-- tags: 弹窗,modal,dialog,drawer,popup -->
## 弹窗组件

| 组件 | 路径 | 说明 |
|------|------|------|
| ResponsiveModal | `components_tw/common/ResponsiveModal` | PC Dialog + Mobile Drawer |

<!-- tags: 签名,wallet,approve,sign,enable,trading -->
## 钱包签名

| Hook | 路径 | 说明 |
|------|------|------|
| useWalletApproveText | `hooks/useWalletApproveText` | 签名文案（4 个 key） |
| useEnableTrading | `hooks/useEnableTrading` | 启用交易签名流程 |
