# i18n 工具 SOP

## 概述

项目使用 `scripts/i18n` 目录下的多语言维护脚本，支持：增量收集、同步、检查、去重、清理、统计、导出等任务。

## 快速入口

```bash
pnpm run i18n
```

进入交互菜单，共 8 个操作：

| 序号 | 操作 | 说明 |
|------|------|------|
| 1 | 增量 | 扫描 `#...#` 标记，写入指定模块 + 重写源码 + **自动翻译** |
| 2 | 同步 | 按 en 同步模块（补空 / 删多余 / 排序） |
| 3 | 检查 | key 排序 + 一致性 + 源码引用缺失 |
| 4 | 修复 | 按字母排序所有 json key |
| 5 | 统计 | 总条目 + 模块条目 + 跨模块重复 |
| 6 | 清理 | 删除未使用 key |
| 7 | 去重 | 统一翻译 + 清理 common 覆盖 + 去重到 common |
| 8 | 导出 | locales → xlsx |

## Trans 组件使用

### 基本语法

```tsx
import { Trans, useTranslation } from "react-i18next";

const { t } = useTranslation(["spot", "common", "manual"]);

// 带样式 + 变量
<Trans
  t={t}
  i18nKey="manual:deposit_at_least"
  components={{
    span: <span className="text-orange-500" />,
  }}
  values={{
    amount: "10",
    coin: "USDT",
  }}
/>
```

### 对应的翻译文件

```json
{
  "deposit_at_least": "Deposit at Least <span>{{amount}} {{coin}}</span>."
}
```

### Trans 组件要点

1. **必须传 `t` 函数**：`<Trans t={t} ... />`
2. **i18nKey 带 namespace**：`i18nKey="manual:key_name"`
3. **components 映射标签**：`<span>` → `components.span`
4. **values 定义变量**：`{{amount}}` → `values.amount`

## 变量处理

### 单个变量

```json
{ "welcome": "Welcome, {{username}}!" }
```

```tsx
t("common:welcome", { username: "John" })
```

### 多个变量

```json
{ "order_info": "Order #{{orderId}} for {{amount}} {{coin}}" }
```

```tsx
t("spot:order_info", { orderId: "123", amount: "100", coin: "USDT" })
```

### 变量 + HTML 标签

```json
{ "deposit_min": "Minimum <span>{{amount}} {{coin}}</span>" }
```

```tsx
<Trans
  t={t}
  i18nKey="manual:deposit_min"
  components={{ span: <span className="highlight" /> }}
  values={{ amount: "10", coin: "USDT" }}
/>
```

## 翻译工作流

### 方式 1：使用 #...# 标记（推荐）

```bash
# 1. 源码中标记文案
t("#新功能提示#")

# 2. 运行增量收集（自动翻译）
pnpm run i18n --hash-to <namespace> --rewrite

# 3. 检查 diff 并提交
git diff && git add . && git commit
```

### 方式 2：手动添加 + 翻译脚本

```bash
# 1. 添加英文 key
vi public/locales/en/spot.json

# 2. 同步到其他语言
pnpm run i18n --sync-by-en spot

# 3. 翻译空值
node .claude/skills/soso-translation/scripts/translate-empty.js spot

# 4. 提交
git add . && git commit
```

## 新增 Namespace

当需要新增 namespace 时：

```bash
# 1. 创建文件
echo "{}" > public/locales/en/<namespace>.json

# 2. 同步到所有语言
pnpm run i18n --sync-by-en <namespace>

# 3. 注册到 i18n 配置（重要！）
# 编辑 src/i18n.ts，在 i18nNS 数组中添加新 namespace
# 示例：const i18nNS = [DEFAULT_NS, "announcement", ..., "notification", ...]

# 4. 更新 TypeScript 类型
# 编辑 src/@declares/i18next-resources.d.ts 添加类型定义

# 5. 更新 SKILL.md 映射表
```

## 已有 Namespace 列表

| Namespace | 用途 | 说明 |
|-----------|------|------|
| `common` | 通用文案 | 默认 namespace，跨模块共享 |
| `spot` | 现货交易 | 交易、订单、行情等 |
| `vault` | 金库/质押 | 存款、提现、收益 |
| `referrals` | 邀请返佣 | 邀请码、返佣记录 |
| `portfolio` | 投资组合 | 资产、收益、历史 |
| `stats` | 数据统计 | 统计图表、报表 |
| `announcement` | 公告 | 公告列表、详情 |
| `explorer` | 区块浏览器 | 交易查询、区块信息 |
| `maintenance` | 维护页面 | 系统维护提示 |
| `manual` | 使用手册 | 帮助文档、说明 |
| `notification` | **错误通知** | **错误提示、状态反馈（全局共享）** |

## 最佳实践

1. **优先使用 #...# 标记**：自动收集 + 自动翻译
2. **Trans 组件用于复杂格式**：带样式、带链接的文案
3. **变量使用 {{xxx}} 格式**：翻译时自动保护
4. **先检查再改动**：运行"检查"了解当前状态
5. **危险操作要 review diff**：去重/清理会改源码
