# 手续费阶梯等级页面

## 架构概览

独立页面（路由 `/futures/step-rate`），展示用户手续费等级体系，包含 5 个区块 + 1 个 MobX Store。

```
┌─────────────────────────────────────────────────────┐
│  StepRate (index.tsx)  页面入口                       │
│  初始化: fetchStepRateTable + fetchOtherPlatforms     │
│          + fetchUserStepRate (登录时)                  │
│                                                       │
│  ┌─ isSpecialAccout ──────────────────────────┐      │
│  │  true  → Special (仅显示费率)               │      │
│  │  false → UserLevel (完整等级卡片)           │      │
│  └────────────────────────────────────────────┘      │
│                                                       │
│  ┌─ SuperPartner ─┐  跳转超级合伙人页面              │
│  ┌─ RateTable ────┐  费率阶梯表格                    │
│  ┌─ LevelDescription ┐  等级规则说明                 │
│  ┌─ ApplyProRate ─┐  申请专业费率入口                │
│  │  └─ ApplyModal  │  上传截图+选平台+选等级         │
│  └────────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
┌──────────────┐     HTTP API (5个)      ┌──────────────────┐
│  StepRate    │ ──────────────────────→  │  models/         │
│  页面 init   │                          │  stepRate.ts     │
│              │                          │                  │
│  useEffect   │  fetchStepRateTable ──→  │  stepRateTable   │
│              │  fetchUserStepRate ───→  │  userStepRate    │
│              │  fetchOtherPlatforms ─→  │  thirdPlatformList│
│              │  fetchUserApplyResult →  │  userApplyResult │
│              │  fetchRecentTradeResult→ │  recentTradeResult│
└──────────────┘                          └────────┬─────────┘
                                                   │ @computed
                                          ┌────────┴─────────┐
                                          │  tabelList       │
                                          │  levelList       │
                                          │  currentLevel    │
                                          │  isSpecialAccout │
                                          └──────────────────┘
```

## 核心逻辑

### 页面初始化（index.tsx L17-67）

页面入口 `StepRate` 在 mount 时并发请求 3 个 API：
- `fetchStepRateTable()` — 获取全部费率等级表
- `fetchOtherPlatforms()` — 获取第三方平台列表（用于申请时选择）
- `fetchUserStepRate()` — 获取用户当前等级（仅登录+已开户时）

未登录 PC 用户重定向到首页：
```typescript
// index.tsx L24-29
useEffect(() => {
  if (!isFromMobile() && !isLogin) {
    push('/');
  }
}, [isLogin]);
```

根据 `isSpecialAccout` 决定渲染 `Special`（仅费率）或 `UserLevel`（完整卡片）。

### 用户等级展示（user-level/index.tsx L10-157）

核心数据来自 `userStepRate`，包含：
- `discountLevel` — 当前等级编号
- `totalTradeVolume` / `ubasedTotalTradeVolume` / `coinBasedTotalTradeVolume` — 交易量
- `makerFee` / `takerFee` — 当前费率
- `lackTradeVolume` / `nextLvTradeVolume` — 升级所需交易量

进度条计算：
```typescript
// user-level/index.tsx L59-60
const progressBN = new BigNumber(totalTradeVolume).div(nextLvTradeVolume);
const progress = progressBN.gte(1) ? '100%' : `${progressBN.times(100).toFixed(2, 1)}%`;
```

等级图标通过 `config.ts` 的 `levelLogoList` 数组映射（level0-level10 共 11 个 SVG）。

### 近期交易量弹窗（user-level/TradeModal.tsx L37-136）

响应式设计：
- PC（≥720px）— `Modal` + `Table` + `Pagination`，每页 5 条
- 移动端（<720px）— `Drawer`，每页 30 条

数据来自 `fetchRecentTradeResult(page, pageSize)`，展示每日 U本位/币本位/累计交易量。

### 费率阶梯表格（rate-table/index.tsx L9-69）

直接渲染 `tabelList`（computed 从 stepRateTable 映射），展示 4 列：等级名、交易量门槛、Maker 费率、Taker 费率。费率乘 100 后显示为百分比。

### 申请专业费率（apply-pro-rate/）

**入口组件**（index.tsx L9-41）：
- `state === 0` → 审核中，禁用按钮
- `state === 1` → 已通过，禁用按钮
- 其他 → 可申请

**申请弹窗**（ApplyModal.tsx L28-231）：
1. 选择第三方平台（多选，数据来自 `thirdPlatformList`）
2. 选择申请等级（单选，数据来自 `levelList`）
3. 上传费率截图（≤5 张，每张 ≤2MB，.jpg/.jpeg/.png/.svg）
4. 提交到 `API.APPLY_PRO_RATE`

上传流程：`customRequest` → `API.UPLOAD_IMG` → `URL.createObjectURL` 预览 → 提交时取 `response.miniUrl/url`。

响应式：PC 用 Modal，移动端（<560px）用 Drawer。

### 超级合伙人入口（super-partner/index.tsx L9-36）

纯跳转组件：
- 移动端 → `Jsb.jsbCall({ type: 'routeTo', key: 7 })`（原生路由）
- PC → `window.open(getExchangeUrl().superPartner)`

### StepRate Store（models/stepRate.ts）

| Observable | 类型 | API |
|-----------|------|-----|
| `stepRateTable` | `StepRateTable[]` | `GET /v1/user/step-rate/getStepRates` |
| `userStepRate` | `UserStepRate` | `GET /v1/user/step-rate/getUserStepRate` |
| `thirdPlatformList` | `string[]` | `GET /v1/user/step-rate/getOtherPlatforms` |
| `userApplyResult` | `ApplyResult` | `GET /v1/user/step-rate/getUserStepApplyResult` |
| `recentTradeResult` | `RecentTradeResult` | `GET /v1/user/step-rate/recent-trade` |

| Computed | 逻辑 |
|----------|------|
| `tabelList` | 从 stepRateTable 提取 id/stepName/tradeVolume/makerFee/takerFee |
| `levelList` | 从 stepRateTable 提取 id/stepName（用于申请下拉） |
| `currentLevel` | 按 discountLevel 索引 tabelList |
| `isSpecialAccout` | `userStepRate.specialType`（特殊账户走简化 UI） |

`ApplyResult.state` 枚举：0=待审核，1=审核通过，2=审核拒绝。

## 跨目录关联组件

以下组件位于 CODE_PATH 外，引用了 `stepRate` store：

| 组件 | 路径 | 说明 |
|------|------|------|
| StepRateGate (spot) | `spot/main/components/stepRateGate/index.tsx` | 现货下单表单内嵌等级入口，Popover 显示费率（spot 版无引用，疑似废弃） |
| StepRateGate (futures) | `futures/main/components/stepRateGate/index.tsx` | 合约下单表单内嵌等级入口，被 `futures/main/orderForm` import |
| FundRateModal (spot) | `spot/main/components/fundRateModal/index.tsx` | 现货费率弹窗，读取 `currentLevel` |
| FundRateModal (futures) | `futures/main/components/fundRateModal/index.tsx` | 合约费率弹窗，读取 `currentLevel` |

这些组件属于下单表单的子组件，非 stepRate 页面本身，不纳入 keyFiles。

## 文件结构

```
src/pages/futures/stepRate/
├── index.tsx                    # 页面入口，初始化+布局
├── config.ts                    # levelLogoList（11个等级图标配置）
├── user-level/
│   ├── index.tsx                # 用户等级卡片（交易量+费率+进度条）
│   ├── Special.tsx              # 特殊账户简化视图（仅费率）
│   └── TradeModal.tsx           # 近期交易量明细弹窗
├── rate-table/
│   └── index.tsx                # 费率阶梯表格
├── level-description/
│   └── index.tsx                # 等级规则说明（5条）
├── apply-pro-rate/
│   ├── index.tsx                # 申请入口（状态判断）
│   ├── ApplyModal.tsx           # 申请弹窗（选平台+选等级+上传截图）
│   └── UploadIcon.tsx           # 上传图标 SVG
└── super-partner/
    └── index.tsx                # 超级合伙人跳转

src/models/stepRate.ts           # MobX Store（5个API + 4个computed）
```

## 关键设计决策

1. **Special vs UserLevel 分流**：特殊账户（`specialType=true`）只看费率，不显示等级/进度/升级提示，避免信息干扰
2. **响应式双容器**：TradeModal 和 ApplyModal 都根据屏幕宽度在 Modal/Drawer 间切换，移动端体验更好
3. **图片上传先传后提交**：每张图片独立上传到 `UPLOAD_IMG`，提交申请时只发送 URL 列表，解耦上传和表单提交
4. **路由保护**：PC 端未登录自动跳首页，但移动端不跳转（由原生壳控制）
5. **等级图标配置化**：`levelLogoList` 数组支持 11 个等级，每个有独立尺寸，超出范围取最后一个

## 开发修改指南

| 场景 | 入口 |
|------|------|
| 新增费率等级 | `config.ts` 添加图标 + 后端 `getStepRates` 接口自动扩展 |
| 修改申请表单字段 | `apply-pro-rate/ApplyModal.tsx` |
| 修改等级规则文案 | `level-description/index.tsx`（i18n key: `stepRate.levelDesc*`）|
| 修改交易量弹窗分页 | `user-level/TradeModal.tsx` L54 `pageSize` |
| 新增申请状态 | `models/stepRate.ts` `ApplyResult.state` + `apply-pro-rate/index.tsx` 条件判断 |

## 术语表

| 术语 | 含义 |
|------|------|
| stepRate | 阶梯费率，用户按交易量分级享受不同 Maker/Taker 费率 |
| discountLevel | 用户当前费率等级编号（0=新用户） |
| bracket | 等级档位 |
| specialType | 特殊账户标记，走独立费率而非阶梯 |
| levelReturnDay | 等级保持剩余天数 |
| thirdPlatform | 第三方交易平台，申请专业费率时需选择 |
| StepRateGate | 交易页下单表单内嵌的等级入口小组件 |

## 更新记录

### 2026-04-09: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
