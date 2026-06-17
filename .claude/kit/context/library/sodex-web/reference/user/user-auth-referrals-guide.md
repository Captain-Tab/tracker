# 邀请页面鉴权流程

## 概述

邀请页面（`/referrals`）具有独立的鉴权流程，使用 `usePageAuth` Hook 管理状态，通过 `createAuthStepsModal`（通用鉴权弹窗）或 `ReferralConnectWalletStepsModal`（旧版两步弹窗）引导用户完成鉴权。页面还包含邀请空投（Claim Rebate）功能，支持链上领取返佣奖励。

```
┌─────────────────────────────────────────────────────────────────┐
│                      邀请页面鉴权 + Claim 架构                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               ReferralsPage (index.tsx)                  │   │
│  │   • usePageAuth({ authType: "referral" })               │   │
│  │   • 数据类型：ReferralStats / ClaimHistoryData /         │   │
│  │     ReferralListData                                     │   │
│  │   • 链上交互：fetchOnChainClaimed（合约读取已领取金额）     │   │
│  │   • claimableRewards = earnedRewardsFromApi - onChain    │   │
│  │   src/pages/referrals/index.tsx                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐             │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ NewReferral  │  │ createAuthSteps │  │ StatsCards /     │  │
│  │ Header       │  │ Modal (通用弹窗) │  │ ReferralTables  │  │
│  │ • Invite     │  │ • Connect       │  │ • ClaimHistory  │  │
│  │ • Claim      │  │ • Sign          │  │ • ReferralList  │  │
│  │ • EnterCode  │  │                 │  │ • Leaderboard   │  │
│  └──────────────┘  └─────────────────┘  └──────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 页面入口

### 数据类型定义

```typescript
// src/pages/referrals/index.tsx L39-114
interface ReferralStats {
  tradersNum: number;           // 已邀请总人数
  totalFeesEarned: number;      // 总收益（Total Fee Rebate）
  pendingRewards: number;       // 待发放奖励
  earnedRewardsFromApi: number; // API 返回的 earnedRewardsOnChain
  originalReferralRebate: number; // 基础返佣（bonusDistributions 中 earnedU）
  delayTopUpAmount: number;     // 1-Month Delay Top-Up（bonusDistributions 中 bonusU）
  pointsTotal: number;
  nextClaimTime?: string;
  eligible: boolean;            // 是否可创建 Code
  cumVlm: number;               // 累计交易量
  vlmThreshold: number;         // 交易量阈值
  vaultNetStake: number;        // Vault 净质押量
  vaultNetStakeThreshold: number;
  referrerStage: string;
  referralCode: string;
  weeklyInviteCount: number;
  maxInvitesPerWeek: number;
  nextAvailableTime?: number;
  canModify?: boolean;
  referredBy?: { referrer: string; code: string } | null;
}

interface ClaimHistoryItem { fees: number; txHash: string; time: number; }
interface ClaimHistoryData { total: number; list: ClaimHistoryItem[]; }
interface ReferralListItem { inviteeWallet: string; referralCode: string; volume: number; paidFees: number; yourRewardedFees: number; yourRewardedPoints: number; referralTime: number; }
interface ReferralListData { total: number; list: ReferralListItem[]; }
```

### 主组件

```typescript
// src/pages/referrals/index.tsx L116-173
export default observer(function Portfolio() {
  // 鉴权弹窗使用通用 createAuthStepsModal
  const openAuthModal = useCallback((callbacks) => {
    createAuthStepsModal.open({
      modalTitle: t("spot:start_earning_with_referrals"),
      step2Text: t("referrals:check_your_referral_code"),
      authType: "referral",
      onTokenObtained: callbacks.onTokenObtained,
      onTokenFailed: callbacks.onTokenFailed,
    });
  }, [t]);

  const { hasToken: hasReferralToken, isInitializing, obtainToken, onTokenObtained, onTokenFailed } = usePageAuth({
    authType: "referral",
    openAuthModal,
  });

  // 链上已领取金额（合约读取）
  const [onChainClaimedRewards, setOnChainClaimedRewards] = useState(0);
  // 前端计算可领取金额
  const claimableRewards = Math.max(0, referralStats.earnedRewardsFromApi - onChainClaimedRewards);
});
```

### Header 组件

```typescript
// src/pages/referrals/components/NewReferralHeader.tsx L29-63
interface NewReferralHeaderProps {
  address?: string | null;
  eligible?: boolean;
  cumVlm?: number;
  vlmThreshold?: number;
  vaultNetStake?: number;
  vaultNetStakeThreshold?: number;
  referralCode?: string;
  claimableRewards?: number;
  originalReferralRebate?: number;
  delayTopUpAmount?: number;
  onChainClaimedRewards?: number;
  weeklyInviteCount?: number;
  maxInvitesPerWeek?: number;
  nextAvailableTime?: number;
  canModify?: boolean;
  referredBy?: { referrer: string; code: string } | null;
  onRefreshData?: () => Promise<{ referredBy?: ... } | null>;
  hasReferralToken?: boolean;
  isInitializing?: boolean;
  hasLoadedReferralStats?: boolean;
  obtainToken?: () => Promise<void>;
  onTokenObtained?: () => void;
  onTokenFailed?: () => void;
  onClaimSuccess?: () => void;  // Claim 成功后回调
}
```

---

## 鉴权状态机

### 状态定义

```typescript
// 复用 usePageAuth 状态
type AuthState =
  | "idle"           // 初始状态（未连接钱包）
  | "checking"       // 检查 token 中
  | "obtaining"      // 获取 token 中
  | "authenticated"  // 已鉴权
  | "unauthenticated"; // 未鉴权
```

### 状态流转图

```
           ┌──────────────────────────────────────────────────────────┐
           │                                                          │
           ▼                                                          │
┌──────────────────┐                                                  │
│      idle        │  用户未连接钱包                                    │
└──────────────────┘                                                  │
           │                                                          │
           │ 连接钱包                                                   │
           ▼                                                          │
┌──────────────────┐                                                  │
│    checking      │  检查本地是否有有效 token                          │
└──────────────────┘                                                  │
           │                                                          │
     ┌─────┴─────┐                                                    │
     │           │                                                    │
     ▼           ▼                                                    │
┌────────┐  ┌────────────────┐                                        │
│  有效   │  │   无效/无 token │                                        │
└────────┘  └────────────────┘                                        │
     │                │                                               │
     ▼                ▼                                               │
┌──────────────────┐  ┌──────────────────┐                            │
│  authenticated   │  │  unauthenticated │                            │
└──────────────────┘  └──────────────────┘                            │
                              │                                       │
                              │ 用户点击 Connect Wallet / Check Code   │
                              ▼                                       │
                      ┌──────────────────┐                            │
                      │    obtaining     │                            │
                      └──────────────────┘                            │
                              │                                       │
                        ┌─────┴─────┐                                 │
                        │           │                                 │
                        ▼           ▼                                 │
                    成功获取      获取失败                              │
                     token                                            │
                        │           │                                 │
                        ▼           │                                 │
               ┌──────────────────┐ │                                 │
               │  authenticated   │ │                                 │
               └──────────────────┘ │                                 │
                                    │                                 │
                                    └─────────────────────────────────┘
```

---

## 两步鉴权弹窗

### 组件入口

```typescript
// src/pages/referrals/components/ReferralConnectWalletStepsModal.tsx L25-29
interface ReferralConnectWalletStepsModalProps extends InjectModalProps {
  onTokenObtained?: () => void;
  onTokenFailed?: () => void;
}
type StepStatus = "active" | "completed" | "pending";
```

### 步骤流程

```
Step 1: Connect Wallet
  → 自动打开 PrivyChekckModal（延迟 1 秒避免弹窗冲突）
  → 连接成功后标记 step1 completed
  → 连接失败（Privy 弹窗关闭但未连接）→ 通知失败并关闭

Step 2: Sign to Verify（依赖 nonce 数据就绪）
  → step1 完成后，先检查本地 token 是否仍有效（checkAuthTokenValid）
    → 有效 → 跳过签名，直接 completed
    → 无效 → 获取 nonce → 等 nonce 就绪后激活 step2
  → step2 active 后自动触发 handleSignMessage
  → 签名成功 → setReferralAuthToken → completed → 延迟关闭
  → 签名被拒绝 → 通知失败并关闭
```

### 核心代码逻辑

```typescript
// src/pages/referrals/components/ReferralConnectWalletStepsModal.tsx

// Step 1 完成后：先检查 token，再获取 nonce（L130-187）
// 优化：避免已有有效 token 时仍要求用户签名
const checkTokenAndGetNonce = async () => {
  const token = local.getReferralAuthToken(address);
  if (token) {
    const res = await checkAuthTokenValid(token);
    if (res?.data?.active === true) {
      setStep2Status("completed");
      onTokenObtained?.();
      return;
    }
    local.removeReferralAuthToken(address);
  }
  await fetchNonce();
};

// Step 2 签名流程（L216-320）：包含消息安全验证
const handleSignMessage = async () => {
  const validation = validateReferralAuthMessage({ message, nonce, domain, address });
  if (!validation.ok) return;
  const signature = await signMessageByWalletType(message);
  const res = await verifyAuthSignature({ address, message, signature, type, autoSign: false });
  local.setReferralAuthToken(res.data.accessToken, address);
};
```

---

## 页面数据获取

### 鉴权前

- 排行榜数据（`getLeaderboardData`）不需要 token
- 无法获取用户专属数据

### 鉴权后

获取用户邀请相关数据（L200-377）：

```typescript
// src/pages/referrals/index.tsx

// 1. 推荐统计（聚合接口）
const fetchReferralData = async () => {
  const statsRes = await getReferralStats({ walletAddress: address });
  // 从 bonusDistributions 提取 originalReferralRebate / delayTopUpAmount
  // 从 referrerState 提取 referralCode / eligible / tradersNum
  setReferralStats(newStats);
};

// 2. Claim 历史（分页）
const fetchClaimHistory = async (page, pageSize) => {
  const res = await getClaimHistory({ walletAddress: address, page, pageSize });
  setClaimHistoryData({ total, list });
};

// 3. 邀请列表（分页，支持 hideZeroReward 过滤）
const fetchReferralList = async (page, pageSize, hideZeroReward) => {
  const res = await getReferralList({ walletAddress: address, page, pageSize, hideZeroReward });
  setReferralListData({ total, list });
};

// 4. 链上已领取金额（合约读取）
const fetchOnChainClaimed = async () => {
  const claimedRaw = await publicClient.readContract({
    address: REFERRAL_CLAIM_CONTRACT_ADDRESS,
    abi: referralClaimAbi,
    functionName: "getClaimedAmount",
    args: [BigInt(REFERRAL_CLAIM_EPOCH_ID), address, VUSDC_ADDRESS],
  });
  setOnChainClaimedRewards(Number(formatUnits(claimedRaw, VUSDC_DECIMALS)));
};

// 5. 可领取金额（前端计算）
const claimableRewards = Math.max(0, referralStats.earnedRewardsFromApi - onChainClaimedRewards);
```

### 数据加载流程

初始加载（L414-466）：等待 `isInitializing` 完成 → 检查 `hasReferralToken` → 并发调用 `fetchReferralData` / `fetchClaimHistory` / `fetchReferralList` / `fetchOnChainClaimed` / `rewards.fetchUserSummary`。

分页变更时仅重新请求对应数据，不触发全屏骨架屏。

---

## UI 状态映射

### Header 按钮显示（NewReferralHeader L232-523）

```
未连接钱包（!isConnected）:
  → Connect Wallet 按钮 → 打开 createAuthStepsModal

已连接但未鉴权（showUnlockOverlay = isConnected && !hasReferralToken && !isInitializing）:
  → "Reveal My Referral Code" 按钮 → handleRevealCodeClick → obtainToken
  → loading 时显示 approveText.wallet（遵循签名交互规范）

已鉴权 + eligible:
  → Invite User 按钮（hasReferralLink 时直接显示，否则包裹 RegionRestrictWrapper）
  → Claim Rebate 按钮（claimableRewards >= 1 可领取，否则 disabled + tooltip）
    → 打开 createClaimRewardsModal，传入 usdcAmount / onClaimSuccess
  → Enter Code 文字链（shouldShowEnterCodeButton = hasLoadedReferralStats && !hasBoundInviteCode）

已鉴权 + 不 eligible:
  → Trade More 按钮 → 跳转 /trade/spot/BTC_USDC
  → Deposit More 按钮 → 跳转 /vault
  （均包裹 RegionRestrictWrapper）
```

### 右侧卡片

```typescript
// ReferralAssetsCard：根据 isConnected / eligible / hasReferralToken 显示不同内容
// 移动端仅在 showAssetsCardOnMobile（isConnected && hasReferralToken）时显示
```

### 全屏 Loading（L639-645）

```typescript
// 有地址且（初始化中 或 有 token 但数据未加载完且未超时）→ 全屏 loading
// 超时安全阀：5 秒后强制放行（dataLoadTimedOut）
if (!!address && (isInitializing || (hasReferralToken && !hasLoadedReferralStats && !dataLoadTimedOut))) {
  return <XtLoading />;
}
```

---

## 事件监听

### authTokenRefreshed 事件

当全局 `useAuthTokenValidation` 自动刷新 Token 后，邀请页面会收到通知：

```typescript
// src/pages/referrals/index.tsx
useEffect(() => {
  const handleTokenRefreshed = (event: CustomEvent) => {
    if (event.detail.address === address) {
      // Token 已刷新，重新获取数据
      refetchUserData();
    }
  };
  
  window.addEventListener("authTokenRefreshed", handleTokenRefreshed);
  return () => {
    window.removeEventListener("authTokenRefreshed", handleTokenRefreshed);
  };
}, [address]);
```

---

## 文件结构

```
src/pages/referrals/
├── index.tsx                     # 主页面组件（数据类型、数据获取、布局）
├── components/
│   ├── NewReferralHeader.tsx     # 页面顶部（Invite/Claim/EnterCode 按钮）
│   ├── NewReferralHeader.styles.ts  # Header 按钮样式
│   ├── ReferralConnectWalletStepsModal.tsx  # 两步鉴权弹窗（旧版）
│   ├── ReferralAssetsCard.tsx    # 右侧资产卡片
│   ├── StatsCards.tsx            # 中部统计数据展示
│   ├── ReferralTables.tsx        # 底部表格（ClaimHistory/ReferralList/Leaderboard）
│   ├── ReferralsFAQ.tsx          # FAQ 区域
│   ├── InviteUserIcon.tsx        # 邀请用户图标
│   └── ...

src/hooks/
├── usePageAuth.ts                # 页面级鉴权 Hook（复用，支持 enableTrading 路径）
└── useWalletApproveText.ts       # 签名文案 Hook

src/http/referrals.ts             # API 接口（getReferralStats/getClaimHistory/getReferralList/getLeaderboardData）
src/http/auth.ts                  # 鉴权 API（getAuthNonce/verifyAuthSignature/checkAuthTokenValid）
src/abi/ReferralClaimAbi.json     # Claim 合约 ABI
src/components_tw/modals/referrals/  # 弹窗组件（InviteToSoDEX/ClaimRewards/EnterCode）
src/components_tw/modals/AuthStepsModal.ts  # 通用鉴权弹窗（createAuthStepsModal）
```

---

## 与其他页面的差异

| 特性 | 邀请页面 | 积分页面 | 普通交易页面 |
|------|----------|----------|--------------|
| AuthSignType | `referral` | `point` | `sign_in` |
| 鉴权触发 | 用户点击按钮 | 用户点击按钮 | 自动/用户触发 |
| 弹窗组件 | ReferralConnectWalletStepsModal | 类似（复用结构） | AuthStepsModal |
| 数据隔离 | 邀请专属 API | 积分专属 API | 通用交易 API |

---

## 关键设计决策

### 1. 使用 usePageAuth 统一管理

不直接操作 `getAuthToken`/`setAuthToken`，而是通过 `usePageAuth` 提供的状态机 API：
- 状态一致性
- 自动处理边界情况
- 与全局鉴权层协调

### 2. 两步弹窗设计

分离「连接钱包」和「签名验证」两个步骤：
- 用户心智清晰
- 错误定位准确
- 支持断点续签

### 3. 自动签名

Step 2 进入后自动发起签名请求，减少用户操作：
- 提升体验
- 减少流失

---

## 术语表

| 术语 | 说明 |
|------|------|
| ReferralConnectWalletStepsModal | 邀请页面两步鉴权弹窗 |
| obtainToken | usePageAuth 提供的获取 Token 方法 |
| onTokenObtained | Token 获取成功回调 |
| onTokenFailed | Token 获取失败回调 |
| authType: "referral" | 邀请页面专用签名类型 |

---

## 代码位置索引

| 功能 | 文件路径 | 行号范围 |
|------|----------|----------|
| 数据类型定义 | `src/pages/referrals/index.tsx` | L39-114 |
| 页面主组件 | `src/pages/referrals/index.tsx` | L116-788 |
| openAuthModal / usePageAuth 配置 | `src/pages/referrals/index.tsx` | L150-173 |
| 数据获取函数 | `src/pages/referrals/index.tsx` | L200-377 |
| 链上 Claim 读取 | `src/pages/referrals/index.tsx` | L358-377 |
| 数据加载 effect | `src/pages/referrals/index.tsx` | L414-466 |
| Header 按钮逻辑 | `src/pages/referrals/components/NewReferralHeader.tsx` | L64-575 |
| Header Props 接口 | `src/pages/referrals/components/NewReferralHeader.tsx` | L29-63 |
| Claim 按钮 | `src/pages/referrals/components/NewReferralHeader.tsx` | L356-447 |
| 两步弹窗 | `src/pages/referrals/components/ReferralConnectWalletStepsModal.tsx` | L30-487 |
| 签名流程 | `src/pages/referrals/components/ReferralConnectWalletStepsModal.tsx` | L216-320 |
| usePageAuth Hook | `src/hooks/usePageAuth.ts` | L98-458 |
| usePageAuth enableTrading 路径 | `src/hooks/usePageAuth.ts` | L270-338 |

---

## 更新记录

### 2026-04-08: 邀请空投 + Claim 功能 + 多项优化

- 新增 Claim Rebate 功能：链上合约读取已领取金额，前端计算 claimableRewards
- 新增数据类型：ReferralStats / ClaimHistoryItem / ClaimHistoryData / ReferralListItem / ReferralListData
- 鉴权弹窗改用通用 createAuthStepsModal
- NewReferralHeader 增加 Claim 按钮、Enter Code 文字链、RegionRestrictWrapper 区域受限
- usePageAuth 增加 enableTrading 路径（已有 userid 用户走 enableTrading，否则走完整签名）
- ReferralConnectWalletStepsModal 增加 token 有效性预检查、nonce 预获取
- 全屏 loading 增加 5 秒超时安全阀

### 2026-03-04: 初始版本

基于代码分析生成，通过 /k/context learn 创建
