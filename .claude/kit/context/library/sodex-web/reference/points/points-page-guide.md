# Points 积分页面

## 架构概览

SoPoints 积分页面（Season 1），根据鉴权状态展示两种视图：

```
┌───────────────────────────────────────────────────────┐
│                    Points (入口)                       │
│              newPoints/index.tsx                       │
│  usePageAuth(authType:"point") + useCountdown          │
├──────────────────────┬────────────────────────────────┤
│                      │                                │
│  connected && hasToken│  否则                          │
│         ↓            │    ↓                           │
│  ┌──────────────┐    │  ┌──────────────────────┐      │
│  │  UserPoints   │    │  │    GuestPoints        │      │
│  │  已鉴权视图   │    │  │    未登录/未鉴权视图  │      │
│  └──────┬───────┘    │  └──────────┬───────────┘      │
│         │            │             │                  │
│  UserPointsCard      │  PointsDashboard               │
│  WeeklyPerformance   │  (积分池+Hero+三功能卡片)      │
│  统计卡片(Pool/Invite)│  EarnCardsGrid                │
│  ShareModal          │  FAQSection                    │
│  FAQSection          │                                │
└──────────────────────┴────────────────────────────────┘
```

### 数据流

```
┌─────────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
│ rewards store       │   │ getUserSummaryService │   │ getWeeklyPointsListService │
│ (MobX 全局)        │   │ (鉴权接口)           │   │ (鉴权接口)               │
│ distributionTime    │   │ → userSummary        │   │ → weeklyPoints            │
│ weekNumber          │   │   totalPoints        │   │   spotVol/futuresVol      │
│ weekPoolPoints      │   │   currentTier        │   │   rank/totalUser          │
└────────┬────────────┘   │   rank/totalUser     │   │   pointsStatus            │
         │                │   nextTier/Points    │   └───────────┬───────────────┘
         │                └──────────┬───────────┘               │
         ↓                           ↓                           ↓
  useCountdown(倒计时)       UserPointsCard              WeeklyPerformance
  → timeLeft               (等级卡片+进度条)            (周表现表格+排序)
```

## 核心逻辑

### 页面入口 — Points

`src/pages/points/newPoints/index.tsx` L16-86

- 复用 `usePageAuth`（`authType: "point"`）管理鉴权状态
- 复用 `createAuthStepsModal` 打开鉴权弹窗（与 Referrals/API Key 相同模式）
- 从全局 `rewards` store 获取 `distributionTime`、`weekNumber`、`weekPoolPoints`
- `useCountdown` 计算下次快照的倒计时

### UserPoints — 已鉴权视图

`src/pages/points/newPoints/userPoints/index.tsx` L41-331

两个数据源：
1. **getUserSummaryService** L74-91 — 用户积分汇总（totalPoints、currentTier、rank、nextTier）
2. **getWeeklyPointsListService** L95-109 — 每周积分列表，使用 `useRetryWithRateLimit` 自动处理限流重试

数据转换 `weeklyTableData` L112-145：
- 将接口的 weekStartTime/weekEndTime 格式化为本地化日期范围
- weekName（"Week 1"）翻译为当前语言（如"第 1 周"）
- pointsStatus 为 "TBD" 时显示待定，"CONFIRMED" 时显示 `+积分数`

### GuestPoints — 未鉴权视图

`src/pages/points/newPoints/guestPoints/index.tsx` + `PointsDashboard.tsx`

展示积分池倒计时 + SoPoints Hero + 三个功能引导卡片：
- **Invite to Earn** — 25% Points + 10% Fee → 跳转 /referrals
- **Trade to Earn** — 跳转 /trade/spot/BTC_USDC
- **Deposit Vault to Earn** — 跳转 /vault

Hero 区域的 "View My Points" 按钮触发鉴权，签名中显示 `walletApproveText.wallet`。

### Tier 等级体系

`src/pages/points/newPoints/userPoints/UserPointsCard.tsx` L27-104

6 个等级，每个等级有独立的渐变背景、边框色、进度条样式：

| 等级 | 渐变色调 | 特殊效果 |
|------|---------|---------|
| Iron | 灰色 (#27272A) | 灰度滤镜 + 沥青纹理 |
| Bronze | 铜色 (#9A6754) | 铝拉丝纹理 |
| Silver | 银色 (#94A3B8) | 铝拉丝纹理 |
| Gold | 金色 (#E0CB82) | 铝拉丝纹理 |
| Diamond | 靛蓝 (#818CF8) | 铝拉丝纹理 |
| Epic | 纯黑 (#1A1A1A) | 碳纤维+星尘纹理+径向高光 |

卡片包含 Hover Shine 动画（`cardShine` keyframe）和进度条内部光泽动画（`shine` keyframe）。

进度条计算 `calculateProgress` L134-141：使用 `floorToDecimal` 保留两位小数，clamp 到 [0, 100]。Epic 或无 nextTier 时强制 100%。

### WeeklyPerformance — 周表现表格

`src/pages/points/newPoints/userPoints/WeeklyPerformance.tsx` L115-237

PC 端表格（8 列 + 排序）/ 移动端折叠面板：

| 列 | 字段 | 排序 |
|----|------|------|
| Week | weekLabel + dateRange | ❌ |
| Spot Vol | spotVol | ✅ |
| Futures Vol | futuresVol | ✅ |
| Vault | vaultHoldings | ✅ |
| OI | oi | ✅ |
| Account Value | accountValue | ✅ |
| Weekly SoPoints | soPoints | ❌ |
| Weekly Ranking | rank/totalUser | ❌ |

排序逻辑三态循环：null → asc → desc → null。

Weekly Ranking 计算：`(rank / totalUser) * 100`，小于 0.01% 显示 "< 0.01%"。

每行可打开分享弹窗（`userSharePointModal`），传入当前周数据。

### 分享系统

`src/pages/points/newPoints/userPoints/UserSharePointContent.tsx`（884行，最大文件）

- `userSharePointModal` — createResponsiveModal，PC 端居中 / 移动端底部弹出
- 两种分享模式：`total`（总排行入口）和 `weekly`（周排行入口）
- 分享设置持久化到 localStorage（`getStoredSettings` / `saveSettings`）

## 文件结构

```
src/pages/points/
├── oldPoints.tsx                         # 旧版积分页（testnet 使用）
├── components/
│   ├── PointsUpgrade.tsx                 # 升级提示组件
│   └── SpecialLoadingBtn.tsx             # 特殊 Loading 按钮
└── newPoints/                            # 新版积分页（mainnet）
    ├── index.tsx                         # 入口：鉴权 → Guest/User 视图切换
    ├── const/index.ts                    # 常量：LEARN_MORE_URL 等
    ├── FAQSection.tsx                    # FAQ 折叠面板（7 个问题）
    ├── guestPoints/
    │   ├── index.tsx                     # Guest 视图容器
    │   ├── PointsDashboard.tsx           # 积分池+Hero+三功能卡片
    │   ├── StackCoinsIcon.tsx            # SVG 图标
    │   └── StarSparkleIcon.tsx           # SVG 图标
    └── userPoints/
        ├── index.tsx                     # User 视图：数据获取+布局
        ├── UserPointsCard.tsx            # 等级卡片（6 级样式+进度条+Shine 动画）
        ├── PointsNumber.tsx              # 积分数字动画组件
        ├── WeeklyPerformance.tsx         # 周表现表格（PC 排序+Mobile 折叠）
        ├── UserSharePointContent.tsx     # 分享弹窗内容（total/weekly 双模式）
        └── modals/index.ts              # createResponsiveModal 注册
```

## 关键设计决策

### 新旧版本共存

路由层通过 `<Env>` 组件切换：testnet 加载 `oldPoints.tsx`，mainnet 加载 `newPoints/`。两套代码完全独立，不共享状态。

### 限流重试机制

`useRetryWithRateLimit` 处理 `getWeeklyPointsListService` 的限流场景：自动检测 429 响应，按指数退避重试（最多 1 次），组件卸载时自动取消。

### 分享弹窗数据选择

分享弹窗需要在 total 和 weekly 模式间切换。`latestWeeklyData` L150-178 按优先级选择最合适的周数据：
1. 有排名数据的周（rank > 0 && totalUser > 0）
2. 有积分数据的周（pointsStatus !== "TBD"）
3. 最新的周（fallback）

### 鉴权复用

与 Referrals、API Key 页面共用 `usePageAuth` + `createAuthStepsModal` 模式，仅替换 `authType` 和文案。

## 开发修改指南

### 添加新的积分获取方式
- GuestPoints：在 `PointsDashboard.tsx` 的 `EarnCardsGrid` 中添加新卡片
- UserPoints：在 `userPoints/index.tsx` 的统计卡片区域添加新面板

### 修改等级样式
- `UserPointsCard.tsx` 中的 `tierConfigs` 对象控制所有等级视觉
- 纹理图片在 `assets/img/rewards/image/` 下

### 修改 Weekly 表格列
- `WeeklyPerformance.tsx` 的 `headers` 数组定义列配置
- `WeeklyDataRow` 接口定义数据结构
- 新增可排序列需添加到 `SortKey` 联合类型

### 注意事项
- `pointsStatus` 为 "TBD" 时：非 Live 周显示 "Snapshot Completed"（有 distributionTime）或 "--"（无）
- `formatAccountValueAndOI`：Live 周和 Week ≤ 2 的历史数据显示 "-"
- Ranking 百分比用 `floorToDecimal` 向下取整，小于 0.01% 显示 "< 0.01%"

## 术语表

| 术语 | 含义 |
|------|------|
| SoPoints | 平台积分，Season 1 每周从 1.5B SOSO 生态基金分配 |
| Season 1 | 积分活动第一季，从 2025-02-01 开始 |
| Snapshot | 每周六 0:00 UTC 快照用户交易数据 |
| Distribution | 每周二 12:00 UTC 分配积分 |
| TBD | To Be Determined，快照完成但积分尚未计算 |
| Week Pool | 当周积分池总量 |
| Tier | 用户等级（Iron→Bronze→Silver→Gold→Diamond→Epic），由总积分决定 |

## 更新记录

### 2026-04-10: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
