# sodex-web UI 还原自检

> L1 查阅文件 — `/k:figma` / `/k:ui` 生成代码后自检
> ⚠️ 本文件只写核对顺序(流程),**不复制 constraints / tokens 具体内容**

## 自检顺序

1. **语义色使用**
   - 涨/跌/警告必须用 `status-up` / `status-down` / `warning-primary`(对照 `constraints.md` §颜色约束)
2. **颜色替换**
   - Figma MCP 变量名按 `figma-mapping.md` 表格替换
   - 非语义色沿用 hex 方括号(对照 `tokens.md` §颜色)
3. **字体与断点**
   - 字体:`font-inter`
   - 响应式:仅 `mobile:` / `pc:`
4. **精度计算**(涉及数值展示时)
   - 使用 `calculate` + `floorToDecimal`(对照 `patterns.md` §precision)
5. **钱包签名**(涉及签名交互时)
   - 文案走 `useWalletApproveText`(对照 `components.md` §签名交互组件)
6. **事件驱动**(涉及 eventBus 时)
   - 跨系统 / 同系统 / 状态覆盖 三维度检查(对照 `patterns.md` §event-driven)
7. **代码规范**
   - 注释中文、简短
   - 不删除被注释的代码(对照 `constraints.md` §代码约束)

## 产出说明(写入 PR / 提交信息)

- **使用的语义 token**:列出 status-up / status-down / warning-primary 使用点
- **新增 hex 硬编码(如有)**:位置 + 原因
- **新增通用组件(如有)**:是否需要提取到 `src/components/`
