# sodex-next UI 还原自检

> L1 查阅文件 — `/k:figma` / `/k:ui` 生成代码后自检
> ⚠️ 本文件只写核对顺序(流程),**不复制 constraints / tokens 具体内容**

## 自检顺序

1. **颜色 token 合法性**
   - 对照 `tokens.md` §颜色 Token(按 Figma 变量名匹配)
   - 核对 `constraints.md` §颜色约束(禁止硬编码 / theme.css 只读 / 豁免条件)
2. **边框 / 背景 / 分隔线 / 圆角**
   - 对照 `constraints.md` §样式约束(divider / 边框 / 圆角 规则)
   - 渐变描边卡(fill+stroke 双渐变):三层 `background` 含**不透明底层**(`patterns.md §gradient-card`),否则金色渗透整卡
3. **间距 / Spacing / Radius / 文本对齐**
   - 对照 `tokens.md` §Spacing Scale(px÷4 规则)
   - 对照 `tokens.md` §Radius Scale(rounded-* 独立 scale)
   - 文本对齐:按文本节点 `textAlignHorizontal` 设 `text-left/center/right`,**不**由父 `justifyContent` 推断
4. **组件用法**
   - 对照 `components.md` §必用组件(禁止原生标签替代)
   - 对照 `components.md` §检查方式(扫描 `<button>` `<input>` 等)
5. **响应式结构**
   - 对照 `patterns.md` §responsive(PC-first / hook vs CSS 变体)
6. **弹窗壳层**
   - 对照 `patterns.md` §modal(壳层禁止项)
   - 弹窗宽度:`classes.content` == Figma 弹窗 frame `dimensions.width`(如 524→`w-131`),**不套默认值**(`patterns.md §modal`)
   - 对照 `constraints.md` §组件约束(openResponsive 位置、title 传入)
7. **命名 / 目录**
   - 对照 `patterns.md` §naming(PC/Mobile 命名)
   - 对照 `patterns.md` §directory(feature/domain/stories 位置)
8. **开发范围**
   - 对照 `constraints.md` §开发范围(Header / Footer / 公告栏不开发)

## 产出说明(写入 PR / 提交信息)

- **使用的 token 清单**:逐条列出本次使用的 token class
- **硬编码豁免(如有)**:位置 + 原因 + 后续替换计划
- **偏离项(如有)**:与规范偏离的点 + 理由
