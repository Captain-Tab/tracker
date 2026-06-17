# {{project}} Figma → Tailwind 映射

> L1 查阅文件 — `/k:figma` 读取

## 核心规则

{{TODO: 例如 "按 Figma 变量名直接转换,禁止仅按 hex 值匹配"}}

## 变量名转换规律

{{TODO: 例如
1. Figma 变量名 `/` → `-`,加 `--` 前缀得 CSS 变量
2. CSS 变量去类别前缀得 KEY
3. Tailwind class = 使用场景前缀 + KEY
}}

## 变量组速查表

| Figma 变量组 | Tailwind 前缀 | 示例类名 | 用途 |
|-------------|--------------|---------|------|
| {{TODO}} | {{TODO}} | {{TODO}} | {{TODO}} |

## 颜色值直查

| Figma hex | 语义 | Tailwind class |
|----------|------|---------------|
| {{TODO}} | {{TODO}} | {{TODO}} |

## 字体映射

| Figma 字体 | Tailwind class |
|-----------|---------------|
| {{TODO}} | {{TODO}} |

## 断点配置

| 名称 | 范围 | 前缀 |
|-----|------|-----|
| {{TODO}} | {{TODO}} | {{TODO}} |

## 查找流程

{{TODO: 例如
1. 获取 Figma 变量名
2. 按转换规律得到 Tailwind class
3. 验证 theme.css 中 token 存在
4. 若无:走主题脚本补充,禁止硬编码
}}
