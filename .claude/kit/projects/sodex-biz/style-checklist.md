# {{project}} UI 还原自检

> L1 查阅文件 — `/k:figma` / `/k:ui` 生成代码后自检
> ⚠️ 本文件只写核对顺序(流程),**不复制 constraints / tokens 具体内容**

## 自检顺序

1. **颜色 token 合法性**
   - 对照 `tokens.md` §颜色 Token
   - 核对 `constraints.md` §颜色约束
2. **间距 / 圆角**
   - 对照 `tokens.md` §Spacing Scale / §Radius Scale
3. **组件用法**
   - 对照 `components.md`(禁止原生替代)
4. **响应式结构**
   - 对照 `patterns.md` §responsive
5. **弹窗壳层**
   - 对照 `patterns.md` §modal + `constraints.md` §组件约束
6. **命名 / 目录**
   - 对照 `patterns.md` §naming / §directory

## 产出说明(写入 PR / 提交信息)

- **使用的 token 清单**: {{逐条列出}}
- **硬编码豁免(如有)**: {{位置 + 原因 + 后续替换计划}}
- **偏离项(如有)**: {{与规范偏离的点 + 理由}}
