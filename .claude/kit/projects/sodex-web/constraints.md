# sodex-web 硬约束

> L0 硬约束 — 被 PROJECT.md `@` 自动引用,任何任务都不能违反

## 颜色约束

- **语义色必须用 token**:涨/成功用 `text-status-up` / `bg-status-up`;跌/错误用 `text-status-down` / `bg-status-down`;警告用 `text-warning-primary` / `bg-warning-primary`
- **禁止用 hex 替代已有语义 token**:例如涨用 `#18B36B` 时必须写 `text-status-up`,不能写 `text-[#18B36B]`
- **非语义背景/文字可用 hex 方括号**:页面底色 `bg-[#121212]`、卡片 `bg-[#1A1A1A]`、次要文字 `text-[#A3A3A3]` 等(详见 tokens.md)
- **Figma 来源使用官方 MCP** 时,按 figma-mapping.md 替换规则转换

## 代码约束(通用)

- **禁止删除被注释的代码**:可能是临时禁用或调试用途,除非用户明确要求
- **注释使用中文**:简短、不写装饰线或分隔符
- **精度计算**:涉及数值比较 / 运算 / 格式化时使用 `calculate` + `floorToDecimal`,禁止 `parseFloat` + `toFixed`(详见 rules/precision-calculation.md)
- **钱包签名交互**:按 `wallet-signing-detect.md` 处理(文案、弹窗、失败状态)
- **事件驱动**:跨系统事件必须检查事件来源唯一性、payload 精确性、state 写入穷举

## 依赖约束

- 禁止引入 `malicious-npm-package.md` 列出的恶意 npm 包
