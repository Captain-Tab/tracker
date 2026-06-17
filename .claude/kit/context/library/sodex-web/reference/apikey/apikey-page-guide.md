# API Key 管理页面

## 架构概览

API Key 页面是 Closed Alpha 功能，提供 API Key 的全生命周期管理。页面状态机如下：

```
┌─────────────────────────────────────────────────────────────┐
│                      ApiKeyPage                             │
│                  src/pages/apiKey/index.tsx                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────┐     │
│  │ 未连接态  │───→│  资格不达标态  │───→│  首次创建空态   │     │
│  │ Connect  │    │ Eligibility  │    │ CreateEmpty    │     │
│  └──────────┘    └──────────────┘    └───────┬────────┘     │
│       │                │                     │              │
│       │                │                     ↓              │
│       │                │              ┌────────────────┐    │
│       │                │              │  API Key 列表  │    │
│       │                │              │  ListState     │    │
│       │                │              └────────────────┘    │
│       │                │                                    │
│  usePageAuth      三条件检查          useApiKeyGenerator    │
│  (鉴权流程)     Tier/Value/Volume      (CRUD 操作)         │
└─────────────────────────────────────────────────────────────┘
```

页面根据鉴权和资格状态，展示四种视图之一：
1. **未连接态** — 展示 Connect 按钮 + 空进度条（占位符数据）
2. **已鉴权但不达标** — 展示三个进度卡片（Tier/AccountValue/Volume）+ 操作按钮
3. **达标但无 Key** — 展示空态引导创建
4. **达标且有 Key** — 展示 API Key 列表 + 操作菜单

### 数据流

```
┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
│ getApiKeyThreshold│    │ getApiKeyEligibility│    │   getApiKeyList  │
│    Config()      │    │    (address)        │    │    (address)     │
│ src/http/user    │    │ src/http/user       │    │ src/http/user    │
└───────┬──────────┘    └────────┬────────────┘    └───────┬──────────┘
        │                        │                         │
        ↓                        ↓                         ↓
  thresholdConfig          eligibilityData           apiKeyRawList
  (全局阈值配置)          (用户当前资格)           (原始 Key 列表)
        │                        │                         │
        └────────┬───────────────┘                         │
                 ↓                                         ↓
          isEligibleForApiKey                    apiKeyList (格式化)
          (三条件任一达标)                       (状态/过期/剩余天数)
```

### 弹窗交互链路

```
用户操作                    弹窗                              后续
─────────────────────────────────────────────────────────────────────
Create Key   →  generateApiKeyModal   →  saveApiKeyResultModal
                (输入 Name + Days)       (展示 Public/Private Key)

Adjust       →  adjustValidityModal
                (修改有效天数)

Delete       →  deleteApiKeyModal     →  deleteApiKeyStepsModal
                (确认删除)               (Spot→Futures 两步签名)
```

## 核心逻辑

### useApiKeyGenerator Hook

`src/pages/apiKey/hooks/useApiKeyGenerator.ts` L47-267

封装 API Key 的三大操作，每个操作都通过 Spark Signer 进行链上签名：

**generateApiKey** L81-139
```typescript
// 1. 使用 viem 生成新密钥对
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

// 2. 构建签名参数，通过 signAddAPIKeyRequest 签名
const signParams: AddAPIKeyParams = {
  accountID, name, type: "1", publicKey: account.address, expiresAt
};
await registerApiKey({ signParams });

// 3. registerApiKey 内部同时注册到 Spot + Futures 双端
await Promise.all([spotUniversalApi(params), futuresUniversalApi(params)]);
```

**adjustApiKeyValidity** L141-184
- 与 generateApiKey 共用 `registerApiKey`，差异在于传入已有 publicKey 而非新生成
- 本质是以相同 name+publicKey 重新注册，覆盖 expiresAt

**revokeApiKeyWithSteps** L186-252
```typescript
// 与 addAPIKey 不同，revoke 需要分别为 Spot/Futures 签名
// ExchangeAction 签名与 domain 绑定，无法复用同一签名
onStepChange?.("spot", "active");
const spotResult = await signRevokeAPIKeyRequest(signParams, KeyType.SPOT);
onStepChange?.("spot", "completed");

onStepChange?.("futures", "active");
const futuresResult = await signRevokeAPIKeyRequest(signParams, KeyType.FUTURES);
onStepChange?.("futures", "completed");

// 双端并行提交
await Promise.all([spotUniversalApi(...), futuresUniversalApi(...)]);
```

### 签名交互规范

所有弹窗均遵循 wallet-signing 规范：
- **ApiKeyGenerateModal** — 一步签名按钮，loading 时显示 `walletApproveText.wallet`  L75
- **ApiKeyAdjustValidityModal** — 一步签名按钮，loading 时显示 `walletApproveText.wallet`  L49
- **ApiKeyDeleteStepsModal** — 两步签名弹窗，副标题显示 `walletApproveText.signature`  L140,149
- **ApiKeyDeleteConfirmModal** — 确认弹窗（不直接签名），但预加载 `walletApproveText`  L16

## 资格验证

### 三条件并行检查

`src/pages/apiKey/index.tsx` L382-406

资格判断采用 OR 逻辑，三个条件任一达标即可创建 API Key：

| 条件 | 数据源 | 判断逻辑 |
|------|--------|----------|
| Tier 等级 | `eligibilityData.currentTier` vs `thresholdConfig.tier` | `TIER_ORDER` 数组索引比较 |
| 账户价值 | `eligibilityData.accountValue` vs `thresholdConfig.accountValue` | 数值 >= 阈值 |
| 交易量 | `eligibilityData.cumulativeVolume` vs `thresholdConfig.volume` | 数值 >= 阈值 |

Tier 等级序列：`IRON → BRONZE → SILVER → GOLD → DIAMOND → EPIC`  L88

### 阈值配置

`getApiKeyThresholdConfig()` 返回全局配置（无需鉴权），包含：
- `tier`: 最低要求等级（如 "GOLD"）
- `soPoints`: 达到该 tier 所需的 SoPoints
- `accountValue`: 最低账户价值（USD）
- `volume`: 最低交易量（USD）

### Tier 视觉样式

`TIER_STYLES` L91-110 为不同 Tier 提供渐变背景和边框色：
- BRONZE: 铜色渐变
- SILVER: 银色渐变
- GOLD: 金色渐变

## 弹窗系统

### 五个响应式弹窗

`src/pages/apiKey/components/modals/index.ts`

所有弹窗通过 `createResponsiveModal` 创建，统一样式：透明背景、无默认 Header、480px 宽度。

| 弹窗 | 组件 | 职责 |
|------|------|------|
| `generateApiKeyModal` | ApiKeyGenerateModal | Key Name 输入（A-Za-z0-9_- 限制36字符）+ Valid Days 输入（1-180天） |
| `saveApiKeyResultModal` | ApiKeySaveResultModal | 展示 Public/Private Key，必须勾选确认后才能关闭（`onlyAllowCloseByManual`） |
| `adjustValidityModal` | ApiKeyAdjustValidityModal | 修改有效期天数 |
| `deleteApiKeyModal` | ApiKeyDeleteConfirmModal | 删除确认（红色危险按钮） |
| `deleteApiKeyStepsModal` | ApiKeyDeleteStepsModal | 两步签名进度（Spot→Futures），`forceType: "pc"` |

### 弹窗链路设计

**创建流程**：`generateApiKeyModal` 关闭后，通过 `setTimeout(..., 0)` 延迟打开 `saveApiKeyResultModal`，避免层叠冲突。

**删除流程**：`deleteApiKeyModal` 确认后，通过 `window.setTimeout(..., 0)` 延迟打开 `deleteApiKeyStepsModal`，同样避免层叠。

### Key Name 验证

`ApiKeyGenerateModal` L38-53：
- 去重检查：与 `existingKeyNames` 不区分大小写比对
- 保留名检查：与 `SYSTEM_KEY_NAMES`（来自 `useSignApi/apiKeyName.ts`）比对
- 字符限制：仅允许 `A-Za-z0-9_-`，最长36字符

## 文件结构

```
src/pages/apiKey/
├── index.tsx                          # 页面主组件（923行），状态管理+视图切换
├── hooks/
│   └── useApiKeyGenerator.ts          # 核心 Hook：生成/调整/撤销 API Key
├── utils/
│   └── locale.ts                      # 语言代码映射（i18n → Intl locale）
├── assets/
│   └── api-key-delete-step-completed.svg
└── components/
    ├── ApiKeySections.tsx              # 桶文件，re-export 所有组件
    ├── ApiKeySectionTypes.ts           # 类型定义：ProgressItem, RequirementItem, ApiKeyListItem
    ├── PageHeader.tsx                  # 页头：标题 + Closed Alpha 徽章 + API Docs + Create 按钮
    ├── TableHeader.tsx                 # 桌面端表头（Name/Status/Public Key/Valid Until/Action）
    ├── EligibilityIntro.tsx            # 资格介绍标题
    ├── EligibilityProgressCard.tsx     # 桌面端进度卡片
    ├── MobileEligibilityProgressCard.tsx # 移动端进度卡片
    ├── MobileEligibilityRow.tsx        # 移动端资格行
    ├── RequirementCard.tsx             # 需求卡片 + OrBadge
    ├── ApiKeyEligibilitySections.tsx   # 资格区域组合组件（Desktop/Mobile）
    ├── ApiKeyCreateEmptyStates.tsx     # 空态引导（Desktop/Mobile）
    ├── ApiKeyListState.tsx             # Key 列表展示（Desktop 表格 / Mobile 卡片+抽屉）
    ├── ApiKeyConnectActionButton.tsx   # Connect/Check Eligibility 按钮
    ├── ApiKeyGenerateModal.tsx         # 生成弹窗
    ├── ApiKeySaveResultModal.tsx       # 保存结果弹窗
    ├── ApiKeyAdjustValidityModal.tsx   # 调整有效期弹窗
    ├── ApiKeyDeleteConfirmModal.tsx    # 删除确认弹窗
    ├── ApiKeyDeleteStepsModal.tsx      # 两步删除进度弹窗
    ├── ApiKeyIcons.tsx                 # SVG 图标集合（10个图标组件）
    └── modals/
        └── index.ts                   # createResponsiveModal 实例注册
```

## 关键设计决策

### 乐观更新策略

`src/pages/apiKey/index.tsx` L527-539, L581-587

创建和删除操作均采用乐观更新：
- **创建**：签名成功后立即将新 Key 插入 `apiKeyRawList`，同时 1.5s 后触发后端刷新确保一致性
- **删除**：撤销成功后立即从列表过滤掉目标 Key，同时 1.5s 后触发后端刷新

为什么这样设计：后端可能有几秒延迟才能查到新数据，乐观更新避免用户看到"操作成功但列表没变"的困惑。

### 双端签名架构

Revoke 操作需要分别为 Spot 和 Futures 签名（不同于 Add 操作可以复用签名），因为 ExchangeAction 的签名与 domain 绑定，Spot/Futures 是不同的 domain。这导致删除流程需要两步签名 UI。

### 鉴权流程复用

`src/pages/apiKey/index.tsx` L282-299

API Key 页面复用了 Points 模块的 `createAuthStepsModal` + `usePageAuth` 鉴权流程，仅替换文案（`authType: "apikey"`）和业务标识。鉴权产生的 auth token 用于访问 eligibility 和 key list 接口。

### Deposit 事件监听

`src/pages/apiKey/index.tsx` L304-327

监听 `DEPOSIT_RECORD_REFRESH` 事件，用户充值成功后自动刷新资格数据（accountValue 可能变化）。使用 800ms 防抖避免 WS 短时间多次触发导致重复请求。

### 钱包地址切换清理

`src/pages/apiKey/index.tsx` L232-240

切换钱包时清除旧账户的 eligibility 和 key list 数据，防止跨账户数据残留。

## 开发修改指南

### 添加新的资格条件
1. 在 `ApiKeyThresholdConfig` 和 `ApiKeyEligibilityData` 接口中新增字段
2. 在 `fetchThresholdConfig` 和 `fetchEligibility` 中解析新字段
3. 在资格判断逻辑中添加新条件（L382-406 区域的 `eligibleNow` 计算）
4. 在 `desktopProgressItems` / `mobileProgressItems` 中添加新的进度卡片

### 修改 API Key 操作
- 所有操作入口在 `useApiKeyGenerator` Hook 中
- 签名流程依赖 `useSparkSigner`（`src/hooks/useSignApi/useSparkSigner.ts`）
- 接口调用通过 `spotUniversalApi` / `futuresUniversalApi`（`src/http/user/index.ts`）

### 修改弹窗
- 弹窗注册在 `components/modals/index.ts`
- 所有弹窗使用 `createResponsiveModal`，统一透明背景样式
- 签名中的按钮文案必须使用 `useWalletApproveText`（参考 wallet-signing 规范）

### 注意事项
- `SYSTEM_KEY_NAMES` 是系统预留的 Key 名称（enable trading 等内部用途），必须从用户列表中过滤
- Key Name 只允许 `A-Za-z0-9_-`，前端做了 IME 组合输入兼容处理
- `apiKeyMaxCount` 硬编码为 5，如需动态化需要后端支持

## 术语表

| 术语 | 含义 |
|------|------|
| Closed Alpha | API Key 功能处于封闭测试阶段，需满足资格才能使用 |
| Spark Signer | 链上签名工具，通过 `useSparkSigner` Hook 调用 |
| Universal API | 统一接口层，通过 `spotUniversalApi` / `futuresUniversalApi` 分发到 Spot/Futures 双端 |
| SYSTEM_KEY_NAMES | 系统内部使用的 Key 名称集合（如 enable trading 自动创建的 Key），不展示给用户 |
| Tier | 用户等级，由 SoPoints 决定，序列为 IRON→BRONZE→SILVER→GOLD→DIAMOND→EPIC |

## 更新记录

### 2026-04-10: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
