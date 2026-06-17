# 自动翻译 Skill - 原始需求

## 目的

在修改或新增 i18n 文件时，自动将内容翻译为所有支持的语言。

## 前置条件

- 翻译脚本：`scripts/i18n/translate/index.js`
- 目标文件：`public/locales/{lang}/<namespace>.json`

## 工作流程

1. **确定 Namespace**：根据路径映射规则确定
2. **执行翻译**：自动将新增/修改的内容翻译为所有语言
3. **提交变更**：一起提交所有翻译文件

## 路径与 Namespace 映射

### 映射优先级

```
1. 精确匹配页面目录 → 对应 namespace
2. 父目录匹配 → 继承父目录的 namespace  
3. 通用组件/其他 → common（兜底）
```

### 完整映射表

| 源码路径 | Namespace | 说明 |
|----------|-----------|------|
| `src/pages/spot/` | spot | 现货交易 |
| `src/pages/vault/` | vault | 金库/质押 |
| `src/pages/referrals/` | referrals | 邀请返佣 |
| `src/pages/portfolio/` | portfolio | 投资组合 |
| `src/pages/stats/` | stats | 数据统计 |
| `src/pages/announcement/` | announcement | 公告 |
| `src/pages/explorer/` | explorer | 区块浏览器 |
| `src/pages/maintenance/` | maintenance | 维护页面 |
| `src/pages/futures/` | spot | 合约交易（复用 spot） |
| `src/pages/order/` | spot | 订单（复用 spot） |
| `src/pages/market/` | spot | 行情（复用 spot） |
| `src/pages/finance/` | common | 财务 |
| `src/pages/account/` | common | 账户 |
| `src/pages/activity/` | common | 活动 |
| `src/pages/home/` | common | 首页 |
| `src/pages/points/` | common | 积分 |
| `src/pages/otc/` | common | OTC 交易 |
| `src/pages/faucet/` | common | 水龙头 |
| `src/pages/_components/deposit/` | spot | 充值组件 |
| `src/pages/_components/withdraw/` | spot | 提现组件 |
| `src/pages/_components/common/` | common | 通用组件 |
| `src/components/` | common | 通用组件 |
| 其他路径 | common | 默认兜底 |

### 新增 Namespace 规则

当遇到以下情况时，需要新增 namespace：

1. **新页面模块**：新建了 `src/pages/<new-module>/` 目录
2. **独立功能域**：该模块有大量专属文案（预计 > 20 条）
3. **业务边界清晰**：与其他模块文案不共享

## 文件结构

```
public/locales/
├── en/           # 源语言（英文）
│   ├── common.json
│   ├── spot.json
│   ├── vault.json
│   ├── referrals.json
│   ├── portfolio.json
│   ├── stats.json
│   ├── announcement.json
│   ├── explorer.json
│   ├── maintenance.json
│   └── manual.json
├── zh/           # 简体中文
├── hk/           # 繁体中文（API 映射为 tc）
├── ja/           # 日语
├── ko/           # 韩语
├── es/           # 西班牙语
├── ru/           # 俄语
├── vi/           # 越南语
├── tr/           # 土耳其语
├── fr/           # 法语
├── pt/           # 葡萄牙语
└── id/           # 印尼语
```
