# 目的：新增命令

## 核心需求

**前置 spec**：`2026-03-17-global-maintenance-guard.md`
**现状**：当前维护检测只有一种模式 -- 全量维护，命中后所有页面重定向到 `/maintenance`。`MaintenanceGuard.tsx` 包裹在 RouteSwitch 中，通过 `useCheckChainStatus` 轮询 `GET /faucet/api/chain/status` 判断维护状态。
**问题**：链维护期间，部分功能（如浏览 portfolio、查看 referrals 信息）仍然可用，全量跳转体验过于粗暴。需要更细粒度的维护等级，让用户在链维护时仍能浏览页面，仅禁用涉及链上操作的按钮。
**目的**：
1. 引入两级维护模式：全量维护（模式一，现有行为）和链维护（模式二，按钮级禁用）
2. 统一维护状态管理，从组件模式升级为 Context 模式
3. 解决 MaintenanceWrapper 与 RegionRestrictWrapper 嵌套冲突问题
---

---

## 核心流程图

MaintenanceProvider（RouteSwitch 内，包裹 Switch）
  ├── 调用 useMaintenanceStatus hook（轮询接口）
  ├── 模式一：全量维护 → history.push("/maintenance")
  └── 模式二：链维护 → Context 下发状态，由 Wrapper 组件消费

子组件消费路径：
  useMaintenanceContext() → { level, isFullMaintenance, isChainMaintenance, estimatedTime }

按钮禁用方案：
  仅维护：<MaintenanceWrapper>  （18 个位置）
  维护+地区重叠：<RestrictWrapper>  （7 个位置）
  Trade 页面：整个内容区覆盖维护遮罩
  Portfolio position 区域：<MaintenancePositionOverlay>

// useMaintenanceStatus 返回值
interface MaintenanceStatus {
  level: 0 | 1 | 2;              // 0=正常, 1=全量维护, 2=链维护
  isFullMaintenance: boolean;     // level === 1
  isChainMaintenance: boolean;    // level === 2
  estimatedTime: string | null;   // 维护预计时长（小时字符串），maintenanceDuration 为 null/undefined 时为 null
  isLoaded: boolean;              // 接口是否已返回，防止初始值误触发跳转
}

// Context 值 = MaintenanceStatus（直接透传）

{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "status": "NORMAL",
    "maintenanceDuration": 0,
    "createTime": 1744500000,
    "updateTime": 1744500000
  }
}

开发者本地（需 VPN + RANCHER_TOKEN）
    ↓ 手动触发
GitHub Actions → Docker Build → Push ECR
    ↓ 手动执行 run.sh / deploy.sh
Rancher API → K8S Rolling Update → Preview 环境

GitHub
  ├── push / PR merge ──→ Webhook ──→ sodex-deploy 服务
  └── Actions 构建完成 ──→ Webhook ──→ sodex-deploy 服务
                                          │
                    ┌─────────────────────┤
                    ↓                     ↓                    ↓
            Rancher API              PostgreSQL           飞书 Webhook
          (K8S 部署/释放)         (环境分配记录)          (通知推送)
                    │                                          │
                    ↓                                          ↓
            preview-01~10                              开发群 @人员
          (K8S Deployments)                         + Linear Issue 链接

sodex-biz/sodex-deploy/
├── main.go
├── go.mod
├── Dockerfile
├── api/
│   └── deploy.api              # go-zero API 定义
├── etc/
│   └── deploy.yaml             # 配置文件（Nacos 覆盖）
├── sql/
│   └── 001_init_environments.sql
├── internal/
│   ├── config/
│   │   └── config.go           # 配置结构体
│   ├── handler/
│   │   ├── webhook_handler.go  # GitHub Webhook 接收
│   │   ├── deploy_handler.go   # 手动部署 API
│   │   └── env_handler.go      # 环境查询 API
│   ├── logic/
│   │   ├── webhook_logic.go    # Webhook 事件处理
│   │   ├── deploy_logic.go     # 部署引擎（调用 Rancher API）
│   │   ├── env_logic.go        # 环境分配/释放
│   │   ├── notify_logic.go     # 飞书通知 + Linear 查询
│   │   └── github_logic.go     # GitHub API 交互
│   ├── svc/
│   │   └── service_context.go  # DI 容器
│   └── types/
│       └── types.go
└── pkg/
    ├── rancher/                # Rancher API client
    ├── github/                 # GitHub App client
    └── linear/                 # Linear API client

POST /webhook/github
    ↓
验证 Webhook Secret (HMAC-SHA256)
    ↓
解析事件类型
    ├── workflow_run.completed
    │   ├── 提取: branch, commit SHA, env_name, conclusion
    │   ├── conclusion != "success" → 忽略
    │   ├── env_name == "preview" → 触发自动部署
    │   └── env_name == "mainnet/testnet" → 仅通知，不自动部署
    │
    └── pull_request.closed (merged)
        ├── 提取: head branch
        ├── 查询该分支绑定的 preview 环境
        └── 触发环境释放

接收构建完成事件
    ↓
查询/分配 preview 环境（见 4.3）
    ↓
构造镜像地址: {ECR}/preview/sodex-web:{SHA}
    ↓
调用 Rancher API (PATCH Deployment)
    ↓
轮询 rollout 状态（每 8s，最多 5min）
    ↓
部署成功 → 更新 DB 记录 → 触发通知
部署失败 → 重试 1 次 → 仍失败则通知告警

PATCH /k8s/clusters/{CLUSTER_ID}/apis/apps/v1/namespaces/sodex-frontend/deployments/{preview-XX}

Header:
  Authorization: Bearer {RANCHER_TOKEN}
  Content-Type: application/strategic-merge-patch+json

Body:
  {
    "spec": {
      "template": {
        "spec": {
          "containers": [{
            "name": "container-0",
            "image": "{ECR}/preview/sodex-web:{SHA}"
          }]
        }
      }
    }
  }

Rancher:
  Url: "https://rancher-dev.sodex.io"
  Token: "token-xxx:xxx"       # Nacos 加密存储
  ClusterId: "c-728ts"
  Namespace: "sodex-frontend"
  Container: "container-0"

ECR:
  Registry: "110427924033.dkr.ecr.ap-northeast-1.amazonaws.com"

Deploy:
  PollInterval: 8              # 秒
  PollTimeout: 300             # 秒（5分钟）
  RetryCount: 1

请求分配 preview 环境（传入 branch）
    ↓
1. 该分支是否已绑定环境？ → 复用
    ↓ 否
2. 是否有空闲环境（preview-01~07）？ → 分配
    ↓ 否
3. LRU：选择最久未部署的环境 → 抢占（通知原分支owner）

PATCH .../deployments/preview-XX
Body: { "spec": { "replicas": 0 } }

-- 环境表
CREATE TABLE deploy_environments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(32)  NOT NULL UNIQUE,  -- preview-01 ~ preview-10
    type        VARCHAR(16)  NOT NULL,         -- auto / manual
    status      VARCHAR(16)  NOT NULL DEFAULT 'idle',  -- idle / occupied
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始数据
INSERT INTO deploy_environments (name, type) VALUES
('preview-01', 'auto'), ('preview-02', 'auto'), ('preview-03', 'auto'),
('preview-04', 'auto'), ('preview-05', 'auto'), ('preview-06', 'auto'),
('preview-07', 'auto'), ('preview-08', 'manual'), ('preview-09', 'manual'),
('preview-10', 'manual');

-- 分配记录表
CREATE TABLE deploy_allocations (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    env_id          BIGINT       NOT NULL,
    branch          VARCHAR(256) NOT NULL,
    commit_sha      VARCHAR(64)  NOT NULL,
    image_tag       VARCHAR(128) NOT NULL,
    deployed_by     VARCHAR(128),              -- GitHub 用户名
    linear_issue_id VARCHAR(64),               -- SOD-97 等
    deploy_url      VARCHAR(256),              -- https://preview-XX.sodex.io
    status          VARCHAR(16)  NOT NULL DEFAULT 'deploying',  -- deploying / success / failed / released
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at     TIMESTAMP    NULL,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (env_id) REFERENCES deploy_environments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_alloc_branch ON deploy_allocations(branch);
CREATE INDEX idx_alloc_status ON deploy_allocations(status);
CREATE INDEX idx_alloc_env_status ON deploy_allocations(env_id, status);

✅ Preview 部署成功

分支: feat/addapikey-sod-97
环境: preview-03
地址: https://preview-03.sodex.io/trade/spot/BTC_USDC
提交: cf27641 - "feat(apiKey): separate key names for web/mobile/qrcode"
需求: SOD-97 - 实现自动化部署
操作: 自动部署（Actions 构建完成触发）
@张三

❌ Preview 部署失败

分支: feat/xxx
环境: preview-05
错误: 部署超时（5分钟），Pod 未就绪
提交: abc1234
请检查: GitHub Actions 构建日志 / Rancher Pod 状态
@张三

🔄 Preview 环境已释放

环境: preview-03 → 空闲
原因: 分支 feat/addapikey-sod-97 已合入 mainnet

⚠️ Preview 环境被抢占

环境: preview-02
原分支: feat/old-feature (@李四)
新分支: feat/new-feature (@王五)
原因: 无空闲环境，抢占最久未更新的环境

feat/addapikey-sod-97  →  SOD-97
fix/sod-123-bug-fix    →  SOD-123

query {
  issue(id: "SOD-97") {
    title
    url
    assignee { name }
  }
}

1. start(address) → 首次调 combined_transfers → 初始化 knownTxHashes + 缓存 blockNumber
2. loop (每3s)：
   a. 调 detected 接口 → 获取 latestBlockNumber
   b. latestBlockNumber > cachedBlockNumber？
      → YES：调 combined_transfers → 处理新记录(toast/事件) → 更新 cachedBlockNumber
      → NO：跳过，等下次
3. stop() → 清理 timer 和状态

// src/http/user/index.ts
export const getTransferDetected = (walletAddress: string) => {
  return request<{ walletAddress: string; latestBlockNumber: number }>(
    `/chain/transfer/detected`,
    { method: "GET", params: { wallet_address: walletAddress }, baseURL: BASE_API_SERVER_URL }
  );
};

---

## 核心组件

| 组件 | 路径 | 作用 |
|------|------|------|
| - GlobalBanner：模式二 + Trade 页面时不显示（在 GlobalBanner 组件内判断 `isChainMaintenance && isTradePage`） | | |
| - **Banner 优先级**：维护状态（全量/链维护）下，GlobalBanner（type 2 维护通知）优先于 RegionRestrictBanner。在 `DepositBanner` wrapper（`components/header/components/depositBanner/index.tsx`）中判断 `isInMaintenance`，维护时跳过地区限制 banner 直接渲染 GlobalBanner。loading 阶段同步处理。 | | |
| | `components/header/components/sign/index.tsx` | 209 | Deposit（已有 RegionRestrictWrapper → RestrictWrapper） | RestrictWrapper | | | |
| | `components_tw/MoblieQRCode/index.tsx` | 140 | QR Code 移动端登录（涉及链上签名 + addAPIKey） | MaintenanceWrapper | | | |
| | `vault/components/SLP.tsx` | 78 | Deposit to SLP Vault（ValueChain 链接） | RestrictWrapper | | | |
| | `vault/components/SLP.tsx` | 88 | Unstake to MAG7.ssi（链接） | MaintenanceWrapper | | | |
| | `vault/components/SLP.tsx` | 121 | Deposit to SLP Vault（Base 链接） | RestrictWrapper | | | |
| | `vault/components/SLP.tsx` | 395 | Get MAG7 ssi（按钮） | RestrictWrapper | | | |
| | `vault/components/SLP.tsx` | 405 | Withdraw（按钮） | MaintenanceWrapper | | | |
| | `vault/components/SLP.tsx` | 412 | Deposit to SLP Vault（主按钮） | RestrictWrapper | | | |

---

## 解决方案


**useMaintenanceStatus hook**（`src/hooks/maintanence/useMaintenanceStatus.ts`）：
- 轮询 `GET /biz/v1/risk-control/global-status`（host: `BASE_API_SERVER_URL` 环境变量），间隔 30 秒
- 接口返回 `status` 字段映射：`NORMAL→0`、`ALL_MAINTENANCE→1`、`CHAIN_MAINTENANCE→2`
- `maintenanceDuration` 为 null/undefined 时保持 `estimatedTime: null`，有值时转为字符串
- `isLoaded: boolean` 标识接口是否已返回，防止初始值触发误跳转
- localStorage `maintenanceMode = "0"` 时跳过所有检测，返回 level=0
- localStorage `maintenanceLevel` 有值时直接使用，不请求接口
- 接口失败时忽略错误，保持用户当前页面状态（level=0，isLoaded=false）

**MaintenanceProvider**（`src/contexts/maintenance/index.tsx`）：
- 调用 `useMaintenanceStatus`，将结果注入 Context
- 规则 1：`isFullMaintenance && !isMaintenancePage` → 跳转 `/maintenance`
- 规则 2：`!isFullMaintenance && isMaintenancePage` → 跳回 `/trade/spot/BTC_USDC`
- 规则 2 覆盖两种场景：恢复正常(level=0) 和 降级为链维护(level=2)
- `isLoaded` 守卫：接口未返回前不执行任何跳转，防闪跳
- DEV 环境跳过模式一跳转，模式二 Wrapper 仍生效

**MaintenanceWrapper**（`src/global/maintanence/MaintenanceWrapper.tsx`）：
- 消费 `useMaintenanceContext()`
- `isChainMaintenance` 为 true 时：children 加 `opacity-50 pointer-events-none` 样式，外层包裹 Tooltip（来自 `@/components_tw/Tooltips`）
- PC 端 hover 显示 "Feature under maintenance"（i18n）
- 移动端点击显示
- 非维护状态直接透传 children

**RestrictWrapper**（`src/global/region-restrict/RestrictWrapper.tsx`）：
- 合并维护检测 + 地区限制检测，优先级：维护 > 地区限制
- `isChainMaintenance` 为 true → 显示维护 tooltip
- `isRestricted` 为 true → 显示地区限制 tooltip
- 都不命中 → 透传 children
- 替换 7 个同时被两种 Wrapper 包裹的位置，避免 opacity 叠加和 tooltip 竞争

**MaintenancePositionOverlay**（`src/global/maintanence/MaintenancePositionOverlay.tsx`）：
- Portfolio position 区域专用遮罩
- 复用 `portifolio-maintainence.svg` 图标
- 文案 "Scheduled Maintenance in Progress"（i18n）

---

## 核心文件

- src/components/baseInfoRequester/index.tsx
- src/contexts/maintenance/index.tsx
- src/global/maintanence/index.tsx
- src/global/maintanence/MaintenanceGuard.tsx
- src/global/maintanence/MaintenancePositionOverlay.tsx
- src/global/maintanence/MaintenanceProvider.tsx
- src/global/maintanence/MaintenanceWrapper.tsx
- src/global/MaintenanceGuard.tsx
- src/global/region-restrict/RestrictWrapper.tsx
- src/hooks/maintanence/useMaintenanceStatus.ts

---

## 完整规范

目的：新增命令

入口文件夹：
/Users/soso/Documents/code/soso-kit/.claude/commands

需求分析：
a.新增一个命令，根据输入内容，prompt, 或链接

b.分析得到风险原因和内容
输出原因和内容，以及如何操作

c分析制定文件夹内的前端项目是否有问题

d.统一查看main分支
sodex-web查看mainnet分支
下面的package.json

e.得出结论，是否有风险
f.给出建议，如果到安全版本
修改问题：

问题描述
1.获取接口，前一个是正常，下一个是全局维护状态
2.从正常状态切换到全局维护状态，进入页面，会跳转到maintenance路由
3.再次获取接口，切换到链维护状态
4.依然停在在maintenace路由

步骤a
a.mock数据
b.使用k:debug
c.插桩
d.手动测试
e.复现问题 收集日志

步骤b,继续添加wrapper
referral页面
a.邀请请页-推荐码修改 没有拦截
b.邀请页-推荐码修改 没有拦截
c.邀请页-填写别人的推荐码也没有拦截# 维护模式升级：多等级维护支持

## 背景与目的

**前置 spec**：`2026-03-17-global-maintenance-guard.md`

**现状**：当前维护检测只有一种模式 -- 全量维护，命中后所有页面重定向到 `/maintenance`。`MaintenanceGuard.tsx` 包裹在 RouteSwitch 中，通过 `useCheckChainStatus` 轮询 `GET /faucet/api/chain/status` 判断维护状态。

**问题**：链维护期间，部分功能（如浏览 portfolio、查看 referrals 信息）仍然可用，全量跳转体验过于粗暴。需要更细粒度的维护等级，让用户在链维护时仍能浏览页面，仅禁用涉及链上操作的按钮。

**目的**：
1. 引入两级维护模式：全量维护（模式一，现有行为）和链维护（模式二，按钮级禁用）
2. 统一维护状态管理，从组件模式升级为 Context 模式
3. 解决 MaintenanceWrapper 与 RegionRestrictWrapper 嵌套冲突问题

---

## 选定方案

**方案 A：Context + Provider 模式**

**核心理由**：
1. Context 提供全局状态共享，任意子组件通过 `useMaintenanceContext()` 消费维护状态，无需逐层传递 props
2. Provider 吸收原有 `MaintenanceGuard.tsx` 的跳转职责，统一入口
3. 通过 `MaintenanceWrapper` 和 `RestrictWrapper` 两种包裹组件，覆盖"仅维护"和"维护+地区限制重叠"两类场景
4. 预留 `level` 字段和 `estimatedTime`，后端扩展接口后零改动对接

---

## 设计概要

### 架构思路

```
MaintenanceProvider（RouteSwitch 内，包裹 Switch）
  ├── 调用 useMaintenanceStatus hook（轮询接口）
  ├── 模式一：全量维护 → history.push("/maintenance")
  └── 模式二：链维护 → Context 下发状态，由 Wrapper 组件消费

子组件消费路径：
  useMaintenanceContext() → { level, isFullMaintenance, isChainMaintenance, estimatedTime }

按钮禁用方案：
  仅维护：<MaintenanceWrapper>  （18 个位置）
  维护+地区重叠：<RestrictWrapper>  （7 个位置）
  Trade 页面：整个内容区覆盖维护遮罩
  Portfolio position 区域：<MaintenancePositionOverlay>
```

### 模式二按钮禁用完整清单（25 个位置）

**Trade** — 模式二下交易内容区替换为维护页面组件（复用 MaintenanceContent），顶部 header 保持可见可点击。PC 和移动端均适用。
- `spot/main/index.tsx`：`if (isChainMaintenance) return <MaintenanceContent />`
- `pages/m/trade/index.tsx`：移动端下单页面（`/m/trade/:instType/:symbolId`），模式二下内容区替换为 MaintenanceContent，保留 MbHeader
- CoinCollectBanner：模式二下不显示（被 early return 跳过）
- GlobalBanner：模式二 + Trade 页面时不显示（在 GlobalBanner 组件内判断 `isChainMaintenance && isTradePage`）
- 其他页面的 GlobalBanner 不受影响
- **Banner 优先级**：维护状态（全量/链维护）下，GlobalBanner（type 2 维护通知）优先于 RegionRestrictBanner。在 `DepositBanner` wrapper（`components/header/components/depositBanner/index.tsx`）中判断 `isInMaintenance`，维护时跳过地区限制 banner 直接渲染 GlobalBanner。loading 阶段同步处理。

  **Banner 优先级场景矩阵**：

  | 场景 | isInMaintenance | isRestricted | 行为 | 与之前对比 |
  |------|----------------|-------------|------|-----------|
  | 正常 + 无限制 | false | false | GlobalBanner | 不变 |
  | 正常 + 有限制 | false | true | RegionRestrictBanner | 不变 |
  | 正常 + 有限制 + loading | false | true | RegionRestrictBanner | 不变 |
  | 维护 + 无限制 | true | false | GlobalBanner | 不变 |
  | 维护 + 有限制 | true | true | GlobalBanner（type 2 优先） | 改变（原来显示 Region） |
  | 维护 + 有限制 + loading | true | true | return null（等 banner 加载） | 改变（原来显示 Region） |

  **实现逻辑**：`if (restriction.isRestrictedRegion && !isInMaintenance) return <RegionRestrictBanner />`，两处判断（loading 阶段 + 正常渲染阶段）同步修改。

**Header（2 个）**：

| 文件 | 行号 | 按钮 | Wrapper |
|------|------|------|---------|
| `components/header/components/sign/index.tsx` | 209 | Deposit（已有 RegionRestrictWrapper → RestrictWrapper） | RestrictWrapper |
| `components_tw/MoblieQRCode/index.tsx` | 140 | QR Code 移动端登录（涉及链上签名 + addAPIKey） | MaintenanceWrapper |

> **注意**：移动端菜单栏（mobileHeadDrawer）中的 Deposit 按钮复用 `sign/index.tsx` 的 `<Sign>` 组件。为使 Drawer 内 RestrictWrapper 能正确消费 MaintenanceContext，已将 `MaintenanceProvider` 提升到 `NiceModal.Provider` 外层（`routers.tsx`）。

**Vault（7 个）**：

| 文件 | 行号 | 按钮 | Wrapper |
|------|------|------|---------|
| `vault/components/SLP.tsx` | 78 | Deposit to SLP Vault（ValueChain 链接） | RestrictWrapper |
| `vault/components/SLP.tsx` | 88 | Unstake to MAG7.ssi（链接） | MaintenanceWrapper |
| `vault/components/SLP.tsx` | 121 | Deposit to SLP Vault（Base 链接） | RestrictWrapper |
| `vault/components/SLP.tsx` | 395 | Get MAG7 ssi（按钮） | RestrictWrapper |
| `vault/components/SLP.tsx` | 405 | Withdraw（按钮） | MaintenanceWrapper |
| `vault/components/SLP.tsx` | 412 | Deposit to SLP Vault（主按钮） | RestrictWrapper |
| `vault/components/modals/funding/_components/CoolDownStatus.tsx` | 43 | Click to Claim（链接） | MaintenanceWrapper |

**Portfolio（3 + overlay）**：

| 文件 | 行号 | 按钮 | Wrapper |
|------|------|------|---------|
| `account/assets/components/btnNav/index.tsx` | 51 | Transfer（BtnNav 内部，portfolio + account 页面共享） | MaintenanceWrapper |
| `account/assets/components/btnNav/index.tsx` | 80 | Withdraw（BtnNav 内部） | MaintenanceWrapper |
| `account/assets/components/btnNav/index.tsx` | 95 | Deposit（BtnNav 内部，原 RegionRestrictWrapper → RestrictWrapper） | RestrictWrapper |
| `portfolio/index.tsx` | position 区域 | 维护遮罩（替换 Position 面板） | MaintenancePositionOverlay |

**Referrals（6 个）**：

| 文件 | 按钮 | Wrapper |
|------|------|---------|
| `referrals/components/NewReferralHeader.tsx` | Claim Rebate | RestrictWrapper |
| `referrals/components/NewReferralHeader.tsx` | Trade More | RestrictWrapper |
| `referrals/components/NewReferralHeader.tsx` | Deposit More | RestrictWrapper |
| 推荐资产区域 | 自定义您的推荐码（签名操作） | MaintenanceWrapper |
| Invite Users 弹窗 | Customize Code → Save（签名操作） | MaintenanceWrapper |
| Enter Code 入口 | Enter here（绑定推荐关系，签名操作） | MaintenanceWrapper |

不禁用：Invite User（仅打开分享弹窗，不涉及链操作）

**Stake（9 个）**：

| 文件 | 行号 | 按钮 | Wrapper |
|------|------|------|---------|
| `stake/StakingHero.tsx` | 111 | Get SOSO to Stake（PC） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 120 | Start Staking（PC） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 127 | Get SOSO（PC） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 149 | Deposit into ValueChain（PC） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 191 | Get SOSO to Stake（移动端） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 200 | Start Staking（移动端） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 207 | Get SOSO（移动端） | MaintenanceWrapper |
| `stake/StakingHero.tsx` | 228 | Deposit into ValueChain（移动端） | MaintenanceWrapper |
| `stake/components/MobileBottomButton.tsx` | 19 | Start Staking（底部固定） | MaintenanceWrapper |

不禁用：Connect Wallet、Learn More

**API Key（12 个）**：

| 文件 | 按钮 | 端 | Wrapper |
|------|------|-----|---------|
| `apiKey/components/PageHeader.tsx` | Create New API Key | 移动端 | MaintenanceWrapper |
| `apiKey/components/PageHeader.tsx` | Create New API Key | PC | MaintenanceWrapper |
| `apiKey/components/ApiKeyCreateEmptyStates.tsx` | Generate API Key（空态） | Desktop | MaintenanceWrapper |
| `apiKey/components/ApiKeyCreateEmptyStates.tsx` | Generate API Key（空态） | Mobile | MaintenanceWrapper |
| `apiKey/components/ApiKeyListState.tsx` | 调整有效期（操作菜单） | PC | MaintenanceWrapper |
| `apiKey/components/ApiKeyListState.tsx` | 删除密钥（操作菜单） | PC | MaintenanceWrapper |
| `apiKey/components/ApiKeyListState.tsx` | 调整有效期（Drawer） | Mobile | MaintenanceWrapper |
| `apiKey/components/ApiKeyListState.tsx` | 删除密钥（Drawer） | Mobile | MaintenanceWrapper |
| `apiKey/components/EligibilityProgressCard.tsx` | 赚取更多积分/存入更多/交易更多（不够资格页） | PC | MaintenanceWrapper |
| `apiKey/components/MobileEligibilityProgressCard.tsx` | 赚取更多积分/存入更多/交易更多（不够资格页） | Mobile | MaintenanceWrapper |

### RestrictWrapper 重叠位置汇总（7 个，原 RegionRestrictWrapper → RestrictWrapper）

| 文件 | 行号 |
|------|------|
| `vault/components/SLP.tsx` | 78, 121, 395, 412 |
| `referrals/components/NewReferralHeader.tsx` | 402, 453, 488 |

### 核心逻辑

**useMaintenanceStatus hook**（`src/hooks/maintanence/useMaintenanceStatus.ts`）：
- 轮询 `GET /biz/v1/risk-control/global-status`（host: `BASE_API_SERVER_URL` 环境变量），间隔 30 秒
- 接口返回 `status` 字段映射：`NORMAL→0`、`ALL_MAINTENANCE→1`、`CHAIN_MAINTENANCE→2`
- `maintenanceDuration` 为 null/undefined 时保持 `estimatedTime: null`，有值时转为字符串
- `isLoaded: boolean` 标识接口是否已返回，防止初始值触发误跳转
- localStorage `maintenanceMode = "0"` 时跳过所有检测，返回 level=0
- localStorage `maintenanceLevel` 有值时直接使用，不请求接口
- 接口失败时忽略错误，保持用户当前页面状态（level=0，isLoaded=false）

**MaintenanceProvider**（`src/contexts/maintenance/index.tsx`）：
- 调用 `useMaintenanceStatus`，将结果注入 Context
- 规则 1：`isFullMaintenance && !isMaintenancePage` → 跳转 `/maintenance`
- 规则 2：`!isFullMaintenance && isMaintenancePage` → 跳回 `/trade/spot/BTC_USDC`
- 规则 2 覆盖两种场景：恢复正常(level=0) 和 降级为链维护(level=2)
- `isLoaded` 守卫：接口未返回前不执行任何跳转，防闪跳
- DEV 环境跳过模式一跳转，模式二 Wrapper 仍生效

**MaintenanceWrapper**（`src/global/maintanence/MaintenanceWrapper.tsx`）：
- 消费 `useMaintenanceContext()`
- `isChainMaintenance` 为 true 时：children 加 `opacity-50 pointer-events-none` 样式，外层包裹 Tooltip（来自 `@/components_tw/Tooltips`）
- PC 端 hover 显示 "Feature under maintenance"（i18n）
- 移动端点击显示
- 非维护状态直接透传 children

**RestrictWrapper**（`src/global/region-restrict/RestrictWrapper.tsx`）：
- 合并维护检测 + 地区限制检测，优先级：维护 > 地区限制
- `isChainMaintenance` 为 true → 显示维护 tooltip
- `isRestricted` 为 true → 显示地区限制 tooltip
- 都不命中 → 透传 children
- 替换 7 个同时被两种 Wrapper 包裹的位置，避免 opacity 叠加和 tooltip 竞争

**MaintenancePositionOverlay**（`src/global/maintanence/MaintenancePositionOverlay.tsx`）：
- Portfolio position 区域专用遮罩
- 复用 `portifolio-maintainence.svg` 图标
- 文案 "Scheduled Maintenance in Progress"（i18n）

### 关键数据结构

```ts
// useMaintenanceStatus 返回值
interface MaintenanceStatus {
  level: 0 | 1 | 2;              // 0=正常, 1=全量维护, 2=链维护
  isFullMaintenance: boolean;     // level === 1
  isChainMaintenance: boolean;    // level === 2
  estimatedTime: string | null;   // 维护预计时长（小时字符串），maintenanceDuration 为 null/undefined 时为 null
  isLoaded: boolean;              // 接口是否已返回，防止初始值误触发跳转
}

// Context 值 = MaintenanceStatus（直接透传）
```

### localStorage 开关

| key | 值 | 说明 |
|-----|------|------|
| `maintenanceMode` | `"0"` | 跳过所有检测，返回 level=0（兼容现有逻辑） |
| `maintenanceLevel` | `"0"` / `"1"` / `"2"` | 开发测试用，优先级高于接口返回 |

优先级：`maintenanceMode="0"` > `maintenanceLevel` > 接口返回值

---

## 边界与约束

### 包含

- 新建 `useMaintenanceStatus` hook，替代 `useCheckChainStatus`
- 新建 `MaintenanceProvider`，替代 `MaintenanceGuard.tsx`
- 新建 `MaintenanceWrapper`、`MaintenancePositionOverlay`、`RestrictWrapper` 组件
- 删除 `src/global/MaintenanceGuard.tsx`
- 删除 `src/hooks/useCheckChainStatus.ts`（逻辑迁移至新 hook）
- 维护页面样式更新：新标题、新文案、新增 Support 按钮
- Trade 页面模式二全局遮挡
- 模式二各页面按钮禁用（25 个按钮位置）
- 7 个重叠位置从 RegionRestrictWrapper 迁移到 RestrictWrapper
- 所有新增文案 i18n

### 不包含

- 不修改后端接口（当前仍返回 boolean）
- 不修改非维护相关的 RegionRestrictWrapper 使用位置
- 不修改 home 页面及其他未列出页面的行为
- 不禁用 Referrals 页的 Enter Code、Invite User
- 不禁用各页面的 Connect Wallet、Share、Learn More 按钮
- 不修改轮询间隔（保持 30 秒）

### useEffect 状态转换矩阵

**两条规则，四象限完备覆盖**：

| 条件 | 匹配规则 | 动作 |
|------|---------|------|
| `isFullMaintenance && !isMaintenancePage` | level=1 + 非维护页 | → /maintenance |
| `!isFullMaintenance && isMaintenancePage` | level≠1 + 维护页 | → /trade |
| `isFullMaintenance && isMaintenancePage` | level=1 + 维护页 | 无动作（正确停留） |
| `!isFullMaintenance && !isMaintenancePage` | level≠1 + 非维护页 | 无动作（正确停留） |

**全部 9 种状态转换**：

| # | 从 → 到 | 用户所在页 | 命中条件 | 行为 |
|---|---------|-----------|---------|------|
| 1 | 0→0 | 交易页 | level 不变，useEffect 不触发 | 保持 ✅ |
| 2 | 0→1 | 交易页 | `isFullMaintenance && !isMaintenancePage` | → /maintenance ✅ |
| 3 | 0→2 | 交易页 | `!isFullMaintenance && !isMaintenancePage` | 保持，按钮禁用 ✅ |
| 4 | 1→0 | /maintenance | `!isFullMaintenance && isMaintenancePage` | → /trade ✅ |
| 5 | 1→1 | /maintenance | level 不变 | 保持 ✅ |
| 6 | 1→2 | /maintenance | `!isFullMaintenance && isMaintenancePage` | → /trade ✅ |
| 7 | 2→0 | 交易页 | `!isFullMaintenance && !isMaintenancePage` | 保持，恢复正常 ✅ |
| 8 | 2→1 | 交易页 | `isFullMaintenance && !isMaintenancePage` | → /maintenance ✅ |
| 9 | 2→2 | 交易页 | level 不变 | 保持 ✅ |

**边界场景**：

| 场景 | 命中条件 | 行为 |
|------|---------|------|
| 手动访问 /maintenance + level=0 | `!isFullMaintenance && isMaintenancePage` | → /trade ✅ |
| 手动访问 /maintenance + level=2 | `!isFullMaintenance && isMaintenancePage` | → /trade ✅ |
| `isLoaded=false`（API 未返回） | early return | 不跳转 ✅ |
| API 异常（catch 分支） | DEFAULT_STATUS: level=0, isLoaded=false | 不跳转，放行 ✅ |

### 已修复的问题清单

| # | 问题 | 严重度 | 修复方式 |
|---|------|--------|----------|
| 1 | Context 默认值 level:1（应为 0） | 中 | 改为 level:0 |
| 2 | `<span>` 包裹破坏 flex 布局 | 高 | 改为 `<div>` |
| 3 | 缺少 inert/keyboard/focus 拦截 | 中 | 补充完整拦截逻辑 |
| 4 | useEffect 多余 history 依赖 | 低 | 移除 |
| 5 | 正常状态访问 /maintenance 不踢回 | 中 | 去掉 prevLevel 条件 |
| 6 | Stake flex-1 被 Wrapper 吞掉 | 高 | className 提升到 Wrapper |
| 7 | Vault mobile:flex-1 被 Wrapper 吞掉 | 高 | className 提升到 Wrapper |
| 8 | 维护页 Support 按钮布局错位 | 中 | 移到独立 flex 容器 |
| 9 | i18n 扁平 key 与 keySeparator 冲突 | 高 | 改为嵌套对象 |
| 10 | `inert={true as unknown as string}` React 警告 | 低 | 改为 `inert` |
| 11 | Referrals Claim Rebate hasReferralLink=true 分支遗漏 | 高 | 补充 RestrictWrapper |
| 12 | 内部 MUI Tooltip 事件穿透 | 中 | 外层 pointer-events-none + 遮罩层 pointer-events-auto |
| 13 | HeadsetIcon deprecated import | 低 | `Headset as HeadsetIcon` → `HeadsetIcon` |
| 14 | 模式 1→2 卡在 /maintenance 不跳转 | 高 | `level===0` 改为 `!isFullMaintenance`，覆盖 level=0 和 level=2 |
| 15 | 模式 2 切换 tab 后 T-Rex 游戏不渲染 | 中 | Runner 单例 cleanup + 精灵图预加载 |
| 16 | 移动端菜单 Drawer 内 Deposit 按钮维护模式不生效 | 高 | MaintenanceProvider 提升到 NiceModal.Provider 外层 |
| 17 | `/m/trade/` 移动端下单页缺少链维护处理 | 高 | MTrade 添加 `isChainMaintenance` 判断 + MaintenanceContent |
| 18 | API Key 操作菜单（调整有效期/删除）未禁用 | 中 | PC ActionMenu + Mobile Drawer 按钮包裹 MaintenanceWrapper |
| 19 | API Key 不够资格页面三个按钮未禁用 | 中 | EligibilityProgressCard + MobileEligibilityProgressCard 按钮包裹 MaintenanceWrapper |
| 20 | AICustomer 仅在 trade 页注册，其他页面 Support 无响应 | 中 | AICustomer + SUPPORT_CLICK 监听提升到全局 Routes 组件 |

### 模式二逐页验证结果

**Trade**：内容区替换为 MaintenanceContent ✅ / Header 可见可点击 ✅ / CoinCollectBanner 不显示 ✅ / GlobalBanner 在 Trade 页不显示 ✅ / 其他页面 GlobalBanner 不受影响 ✅

**Header（2 个）**：Deposit → RestrictWrapper ✅ / QR Code → MaintenanceWrapper ✅

**Vault（7 个）**：全部 ✅（RestrictWrapper 4 个 + MaintenanceWrapper 3 个）

**Portfolio（3 + overlay）**：Transfer/Withdraw → MaintenanceWrapper ✅ / Deposit → RestrictWrapper ✅ / Position overlay ✅

**Referrals（4 个）**：Claim Rebate×2 + Trade More + Deposit More → RestrictWrapper ✅ / Enter Code 不禁用 ✅ / Invite User 保留原 RegionRestrictWrapper ✅

**Stake（9 个）**：全部 ✅ / Connect Wallet 不禁用 ✅

**API Key（4 个）**：全部 ✅

### Wrapper 行为检查

| 检查项 | MaintenanceWrapper | RestrictWrapper |
|--------|-------------------|-----------------|
| 非禁用时零额外 DOM | ✅ | ✅ |
| 禁用时 opacity-50 + inert | ✅ | ✅ |
| 键盘/焦点拦截 | ✅ | ✅ |
| 内部 Tooltip 不穿透 | ✅ | ✅ |
| inline prop 支持 | ✅ | 不需要 |
| className 透传 | ✅ | ✅ |

### RestrictWrapper 兼容性

- 9 个替换位置全部正确 ✅
- 优先级：维护 > 地区限制 ✅
- 维护解除后降级为地区限制 ✅
- 非重叠位置 RegionRestrictWrapper 不受影响 ✅

### 已知限制

- 后端接口当前只返回 boolean，无法区分模式一和模式二，需要通过 localStorage `maintenanceLevel` 手动切换测试模式二
- `estimatedTime` 字段在后端扩展前始终为 null，维护页面暂不显示预计时长
- 模式一跳转使用 `location.href` 硬刷新（现有行为，不在本次修改范围）
- 正常状态用户手动输入 /maintenance 但后端实际维护中——会经历一次 /trade → /maintenance 闪跳（严重度低，最终结果正确）

---

## 集成点

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/hooks/maintanence/useMaintenanceStatus.ts` | 维护状态 hook，轮询接口 + localStorage 逻辑 |
| `src/contexts/maintenance/index.tsx` | Context Provider + 模式一跳转 |
| `src/global/maintanence/MaintenanceWrapper.tsx` | 模式二按钮禁用包裹组件 |
| `src/global/maintanence/MaintenancePositionOverlay.tsx` | Portfolio position 区域遮罩 |
| `src/global/region-restrict/RestrictWrapper.tsx` | 维护 + 地区限制统一包裹 |
| `src/global/maintanence/index.tsx` | 统一导出 |
| `src/assets/img/maintenance/portifolio-maintainence.svg` | Position 区域维护图标（已存在） |

### 删除文件

| 文件 | 说明 |
|------|------|
| `src/global/MaintenanceGuard.tsx` | 职责被 MaintenanceProvider 吸收 |
| `src/hooks/useCheckChainStatus.ts` | 逻辑迁移至 useMaintenanceStatus |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/routers.tsx` | MaintenanceProvider 提升到 NiceModal.Provider 外层 + AICustomer/SUPPORT_CLICK 全局化 |
| `src/pages/maintenance/index.tsx` | 更新标题、文案、新增 Support 按钮 |
| `src/pages/maintenance/MaintenanceContent.tsx` | T-Rex 游戏 cleanup + 精灵图预加载 |
| `src/pages/maintenance/t-rex-runner/index.js` | 新增 destroyRunner 导出函数 |
| `src/pages/vault/components/SLP.tsx` | 6 个按钮包裹 MaintenanceWrapper / RestrictWrapper |
| `src/pages/vault/components/modals/funding/_components/CoolDownStatus.tsx` | 1 个按钮包裹 MaintenanceWrapper |
| `src/pages/portfolio/components/Overview.tsx` | BtnNav 包裹 MaintenanceWrapper + position 区域 MaintenancePositionOverlay |
| `src/pages/referrals/components/NewReferralHeader.tsx` | 3 个按钮 RegionRestrictWrapper → RestrictWrapper |
| `src/pages/stake/StakingHero.tsx` | 8 个按钮包裹 MaintenanceWrapper |
| `src/pages/stake/components/MobileBottomButton.tsx` | 1 个按钮包裹 MaintenanceWrapper |
| `src/pages/apiKey/components/PageHeader.tsx` | 2 个按钮包裹 MaintenanceWrapper |
| `src/pages/apiKey/components/ApiKeyCreateEmptyStates.tsx` | 2 个按钮包裹 MaintenanceWrapper |
| `src/pages/apiKey/components/ApiKeyListState.tsx` | 操作菜单 4 个按钮包裹 MaintenanceWrapper（PC 2 + Mobile 2） |
| `src/pages/apiKey/components/EligibilityProgressCard.tsx` | 不够资格页面按钮包裹 MaintenanceWrapper（PC） |
| `src/pages/apiKey/components/MobileEligibilityProgressCard.tsx` | 不够资格页面按钮包裹 MaintenanceWrapper（Mobile） |
| `src/pages/spot/main/index.tsx` | Trade 页面模式二全局遮挡 + 移除局部 AICustomer |
| `src/pages/m/trade/index.tsx` | 移动端下单页添加链维护处理 |

### 涉及 API

| 接口 | 方法 | 说明 |
|------|------|------|
| ~~`/faucet/api/chain/status`~~ | ~~GET~~ | ~~旧接口，已弃用~~ |
| `GET /biz/v1/risk-control/global-status` | GET | 新接口，无需鉴权，返回维护状态 |

**新接口响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "status": "NORMAL",
    "maintenanceDuration": 0,
    "createTime": 1744500000,
    "updateTime": 1744500000
  }
}
```

**字段映射**：
| status | level | 说明 |
|--------|-------|------|
| `NORMAL` | 0 | 正常 |
| `ALL_MAINTENANCE` | 1 | 全量维护 |
| `CHAIN_MAINTENANCE` | 2 | 链维护 |

`maintenanceDuration` → `estimatedTime`（有值则转字符串，null/undefined 保持 null）

**Host**: preview 环境使用 `https://preview-biz.sodex.dev`

### i18n 新增 key

| key（建议） | 文案 |
|-------------|------|
| `maintenance.feature_under_maintenance` | Feature under maintenance |
| `maintenance.scheduled_title` | Scheduled Maintenance in Progress |
| `maintenance.scheduled_description` | SoDEX is performing Network Upgrades...Estimated completion time: {estimatedTime} hours. |
| `maintenance.get_support` | Get Support |

---

## 执行步骤

### 步骤 a：封装核心逻辑
1. 新建 `src/hooks/maintanence/useMaintenanceStatus.ts`，实现轮询 + localStorage 逻辑 + MaintenanceStatus 接口
2. 新建 `src/global/maintanence/MaintenanceProvider.tsx`，实现 Context Provider + 模式一跳转逻辑
3. 删除 `src/global/maintanence/MaintenanceGuard.tsx`（已存在的旧文件）
4. 删除 `src/hooks/useCheckChainStatus.ts`
5. 更新 `src/routers.tsx`：MaintenanceGuard → MaintenanceProvider 包裹 Switch
6. 更新 `src/global/maintanence/index.tsx` 导出

### 步骤 b：更新 maintenance 维护页面
- Figma 设计稿：https://www.figma.com/design/Azo4rMd3WrDbldUXz8cqng/SoDEX?node-id=27050-163745&t=iLE3r59Tsxfxo1Ja-4
1. 执行 `/k/ui` 命令修改 `src/pages/maintenance/index.tsx` 样式
2. 更新标题为 "Scheduled Maintenance in Progress"（i18n）
3. 更新文案，`estimatedTime` 为变量参数预留
4. 新增 Support 按钮：复用 `@phosphor-icons/react` 的 `HeadsetIcon size={32}`，点击跳转 `BUG_REPORT_URL`，文案 "Get Support"（i18n）

### 步骤 c：封装组件
核心目录：`src/global/maintanence/`

1. 新建 `MaintenanceWrapper.tsx`：复用 `@/components_tw/Tooltips`，PC hover / 移动端点击显示 "Feature under maintenance"（i18n）
2. 新建 `RestrictWrapper.tsx`：合并维护 + 地区限制，优先级维护 > 地区
3. 新建 `MaintenancePositionOverlay.tsx`：Portfolio position 区域维护遮罩
   - Figma 设计稿：https://www.figma.com/design/Azo4rMd3WrDbldUXz8cqng/SoDEX?node-id=27240-150985&m=dev
   - 复用 `src/assets/img/maintenance/portifolio-maintainence.svg` 图标
   - 文案 "Scheduled Maintenance in Progress"（i18n）
   - 执行 `/k/ui` 命令修改样式
4. 更新 `index.tsx` 统一导出所有组件

### 步骤 d：模式二各页面对接
1. Trade 页面：`spot/main/index.tsx` 添加全局维护遮罩
2. Vault 页面：`SLP.tsx` 7 个按钮 + `CoolDownStatus.tsx` 1 个按钮
3. Portfolio 页面：`Overview.tsx` 包裹 BtnNav + 添加 MaintenancePositionOverlay
4. Referrals 页面：`NewReferralHeader.tsx` 3 个按钮 RegionRestrictWrapper → RestrictWrapper
5. Stake 页面：`StakingHero.tsx` 8 个按钮 + `MobileBottomButton.tsx` 1 个按钮
6. API Key 页面：`PageHeader.tsx` 2 个按钮 + `ApiKeyCreateEmptyStates.tsx` 2 个按钮

### 步骤 e：后端接口对接
1. 在 `useMaintenanceStatus` 中预留 TODO 标记
2. 当前映射：`true` → level=0，`false` → level=1
3. 等后端扩展接口后替换数据源

### 最后步骤：国际化
1. 检查所有新增文案的翻译 key
2. 执行 `/soso-translation-auto` 完成多语言翻译

---

## 验收标准

### 功能验收

- [ ] 模式一（level=1）：用户在任意页面自动跳转到 `/maintenance`
- [ ] 模式一 → 恢复（level=0）：从 `/maintenance` 自动跳回 `/trade/spot/BTC_USDC`
- [ ] 模式二（level=2）：用户可正常浏览所有页面，不发生跳转
- [ ] 模式二：Trade 页面内容区被维护遮罩覆盖
- [ ] 模式二：Vault 页面 7 个指定按钮被禁用，hover 显示 tooltip
- [ ] 模式二：Portfolio BtnNav 被禁用，position 区域显示维护遮罩
- [ ] 模式二：Referrals 页 3 个按钮被禁用（Enter Code、Invite User 不受影响）
- [ ] 模式二：Stake 页面 9 个按钮被禁用（Learn More 不受影响）
- [ ] 模式二：API Key 页面 4 个按钮被禁用
- [ ] 模式二 → 恢复（level=0）：所有 Wrapper 自动解除，按钮恢复可用
- [ ] 维护页面显示新标题 "Scheduled Maintenance in Progress"
- [ ] 维护页面显示 Support 按钮，点击跳转 BUG_REPORT_URL
- [ ] 7 个重叠位置使用 RestrictWrapper，无 opacity 叠加问题
- [ ] 所有新增文案通过 i18n 输出

### 回归验收

- [ ] 网络请求中只有 1 个 `/biz/v1/risk-control/global-status` 轮询（无重复调用）
- [ ] `localStorage.maintenanceMode = "0"` 时不触发任何维护逻辑
- [ ] `localStorage.maintenanceLevel` 设值后直接生效，不请求接口
- [ ] DEV 环境不触发模式一跳转，模式二 Wrapper 正常生效
- [ ] 接口请求失败时默认 level=0，页面正常使用
- [ ] 已在 `/maintenance` 页面时，模式一不重复跳转
- [ ] 非重叠位置的 RegionRestrictWrapper 功能不受影响
- [ ] BtnNav 在 account 页面调用时不被维护包裹影响

### 代码验收

- [ ] `src/global/MaintenanceGuard.tsx` 已删除
- [ ] `src/hooks/useCheckChainStatus.ts` 已删除
- [ ] `useMaintenanceStatus` 内有 TODO 标记后端接口扩展
- [ ] 目录名使用 `maintanence`（与项目现有拼写一致）
- [ ] 组件名和变量名使用正确拼写 `Maintenance`
- [ ] Tooltip 使用 `@/components_tw/Tooltips`（非 @mui/material）
- [ ] Support 按钮图标使用 `@phosphor-icons/react` 的 HeadsetIcon size={24}

---

## 验收场景

### 场景 1：全量维护跳转

**Given** 用户在 `/vault` 页面，接口返回 `false`（level=1 全量维护）
**When** 下一次轮询（30 秒内）完成
**Then** 页面自动跳转到 `/maintenance`，显示 "Scheduled Maintenance in Progress" 标题和 Support 按钮

### 场景 2：全量维护恢复

**Given** 用户在 `/maintenance` 页面，当前 level=1
**When** 接口返回 `true`（level=0 正常），轮询周期到达
**Then** 页面自动跳转到 `/trade/spot/BTC_USDC`

### 场景 3：链维护按钮禁用（仅维护位置）

**Given** `localStorage.maintenanceLevel = "2"`，用户在 Stake 页面
**When** 页面渲染完成
**Then** "Get SOSO to Stake"、"Start Staking"、"Get SOSO"、"Deposit into ValueChain" 等 9 个按钮呈半透明禁用态，PC 端 hover 显示 "Feature under maintenance" tooltip，移动端点击显示 tooltip

### 场景 4：链维护按钮禁用（重叠位置）

**Given** `localStorage.maintenanceLevel = "2"`，用户在 Referrals 页面
**When** hover "Claim Rebate" 按钮
**Then** 显示 "Feature under maintenance" tooltip（维护优先级高于地区限制），Enter Code 和 Invite User 按钮正常可用

### 场景 5：链维护 Trade 页面遮挡

**Given** `localStorage.maintenanceLevel = "2"`，用户在 `/trade/spot/BTC_USDC`
**When** 页面渲染完成
**Then** 交易内容区替换为维护页面（显示维护标题、文案、Join Community、Get Support 按钮），顶部 header 保持可见可点击

### 场景 6：链维护 Portfolio position 遮罩

**Given** `localStorage.maintenanceLevel = "2"`，用户在 `/portfolio` 页面
**When** 页面渲染完成
**Then** BtnNav 区域被禁用并显示 tooltip；position 区域显示 `portifolio-maintainence.svg` 图标和 "Scheduled Maintenance in Progress" 文案

### 场景 7：维护模式切换 1 → 2

**Given** 用户在 `/maintenance` 页面，当前 level=1
**When** 维护等级变更为 level=2（链维护）
**Then** 页面自动跳回 `/trade/spot/BTC_USDC`，链维护由各页面 Wrapper 组件接管禁用

### 场景 8：维护模式切换 2 → 0

**Given** 用户在 `/vault` 页面，当前 level=2，Vault 页面按钮处于禁用态
**When** 维护等级变更为 level=0（正常）
**Then** 所有被 MaintenanceWrapper / RestrictWrapper 包裹的按钮恢复可用，tooltip 不再显示

### 场景 9：localStorage 优先级

**Given** `localStorage.maintenanceMode = "0"`，接口返回 `false`（维护中）
**When** 轮询完成
**Then** 不触发任何维护逻辑，页面正常使用，level=0

### 场景 10：localStorage maintenanceLevel 覆盖

**Given** `localStorage.maintenanceLevel = "2"`，接口返回 `true`（正常）
**When** 页面加载
**Then** 不请求接口，直接使用 level=2，各页面按钮进入禁用态

### 场景 11：接口异常降级

**Given** `GET /biz/v1/risk-control/global-status` 返回 500 错误，无 localStorage 覆盖
**When** 轮询请求失败
**Then** 忽略错误，保持用户当前页面状态，不触发维护逻辑

### 场景 12：DEV 环境行为

**Given** `__IS_DEV__ = true`，接口返回 `false`（level=1 全量维护）
**When** 轮询完成
**Then** 不触发模式一跳转（用户留在当前页面），但若手动设置 `maintenanceLevel = "2"`，模式二 Wrapper 正常生效

### 场景 13：RestrictWrapper 地区限制降级

**Given** level=0（正常），用户所在地区被限制，在 Vault 页面
**When** hover "Deposit to SLP Vault" 按钮
**Then** 显示地区限制 tooltip（维护未生效，降级到地区限制逻辑）

### 场景 14：维护页面 Support 按钮

**Given** 用户在 `/maintenance` 页面
**When** 点击 "Get Support" 按钮
**Then** 跳转到 BUG_REPORT_URL，按钮显示 HeadsetIcon 图标（size=24）
目的：优化combined_transfer接口处理逻辑

优化目的：使用策略减少combined_transfer接口调用

优化策略：
a.目前前端可以先调用一次combind_transfers，其中最新交易记录有个区块号的，记录起来，

b后面轮询https://sodex.dev/mainnet/chain/transfer/detected?wallet_address=0xc0146309076c36C917f2391a39668a63031eD76b 这个，返回格式为{"code":0,"message":"Success","data":{"walletAddress":"0xc0146309076c36C917f2391a39668a63031eD76b","latestBlockNumber":7212884}}，

c 3s一次， 每次轮训后比较latestBlockNumber的值是否大于之前记录的最新区块号，大于就去访问combind_transfers获取最新的交易列

具体一点
1 首次 加载的时候需要从combined_transfer 获取区块高度 
2 那么就是首次加载的时候会加载一次combined_transfer 
3 将这个blockNumber缓存起来 
4 每3s一次轮询
5 如果期间blocknumber以后变化就请求combined_transfer
6 更新blocknumber

执行顺序
a.执行/k:context load /Users/soso/Documents/code/sodex-web-feature/.claude/kit/context/library/sodex-web/history/trade/trade-position/2026-04-10-polling-boost-and-fixes.md
b.了解之前的逻辑逻辑
c.本次需要移除之前的逻辑
d.了解现在的处理方式
e.执行/k:clarify
f.等待确认细节# 自动化部署服务 — 功能规范

> 目标：将前端部署从"开发者本地脚本"迁移到"云端自动化服务"，消除本地密钥依赖，实现环境自动分配/释放和部署通知。

---

## 一、现状分析

### 当前部署流程

```
开发者本地（需 VPN + RANCHER_TOKEN）
    ↓ 手动触发
GitHub Actions → Docker Build → Push ECR
    ↓ 手动执行 run.sh / deploy.sh
Rancher API → K8S Rolling Update → Preview 环境
```

### 现有基础设施

| 组件 | 技术 | 说明 |
|------|------|------|
| CI 构建 | GitHub Actions | 手动触发 `build.yml`，构建 Docker 镜像推送 ECR |
| 镜像仓库 | AWS ECR | `110427924033.dkr.ecr.ap-northeast-1.amazonaws.com` |
| 容器编排 | K8S (Rancher) | `https://rancher-dev.sodex.io`，集群 `c-728ts` |
| 命名空间 | `sodex-frontend` | 所有 preview 环境部署在此 |
| 镜像标签 | Git SHA (40位) | `{ECR}/{env}/sodex-web:{SHA}` |
| 环境数量 | preview-01 ~ preview-10 | 1-7 自动分配，8-10 手动保留 |

### 现有问题

| 问题 | 影响 |
|------|------|
| 本地需配置 RANCHER_TOKEN | 安全风险，密钥分散在开发者机器 |
| 手动触发构建和部署 | 效率低，易遗忘 |
| 无环境分配记录 | 不知道哪个分支占用哪个环境 |
| 分支合并后环境不释放 | 资源浪费 |
| 部署完成无通知 | 相关人员无法及时知晓 |
| 无 Linear Issue 关联 | 无法追踪需求对应部署 |

---

## 二、需求清单

| ID | 需求 | 优先级 |
|----|------|--------|
| D1 | 云端拉取 GitHub 构建信息并部署，无需本地密钥 | P0 |
| D2 | 配置 GitHub 读账户获取 Actions 构建路径 | P0 |
| D3 | 分支合入主线后自动释放 K8S Pod 资源 | P0 |
| D4 | 资源分配记录存储方案 | P0 |
| D5 | 部署信息推送开发群（含 Linear Issue、@人员） | P1 |
| D6 | preview-01~07 自动分配，08~10 手动保留 | P0 |

---

## 三、技术方案

### 3.1 整体架构

```
GitHub
  ├── push / PR merge ──→ Webhook ──→ sodex-deploy 服务
  └── Actions 构建完成 ──→ Webhook ──→ sodex-deploy 服务
                                          │
                    ┌─────────────────────┤
                    ↓                     ↓                    ↓
            Rancher API              PostgreSQL           飞书 Webhook
          (K8S 部署/释放)         (环境分配记录)          (通知推送)
                    │                                          │
                    ↓                                          ↓
            preview-01~10                              开发群 @人员
          (K8S Deployments)                         + Linear Issue 链接
```

### 3.2 服务定位

**在 `sodex-biz` monorepo 内新增 `sodex-deploy` 服务**

理由：
- 复用现有基础设施（Nacos 配置中心、ES 日志、飞书通知模式、GitHub Actions CI/CD）
- 独立 `go.mod`，不污染业务服务依赖
- 后端团队熟悉 monorepo 结构，开发和 review 成本低
- CI/CD 仅需在 `build-images.yml` 新增一行配置

### 3.3 项目结构

```
sodex-biz/sodex-deploy/
├── main.go
├── go.mod
├── Dockerfile
├── api/
│   └── deploy.api              # go-zero API 定义
├── etc/
│   └── deploy.yaml             # 配置文件（Nacos 覆盖）
├── sql/
│   └── 001_init_environments.sql
├── internal/
│   ├── config/
│   │   └── config.go           # 配置结构体
│   ├── handler/
│   │   ├── webhook_handler.go  # GitHub Webhook 接收
│   │   ├── deploy_handler.go   # 手动部署 API
│   │   └── env_handler.go      # 环境查询 API
│   ├── logic/
│   │   ├── webhook_logic.go    # Webhook 事件处理
│   │   ├── deploy_logic.go     # 部署引擎（调用 Rancher API）
│   │   ├── env_logic.go        # 环境分配/释放
│   │   ├── notify_logic.go     # 飞书通知 + Linear 查询
│   │   └── github_logic.go     # GitHub API 交互
│   ├── svc/
│   │   └── service_context.go  # DI 容器
│   └── types/
│       └── types.go
└── pkg/
    ├── rancher/                # Rancher API client
    ├── github/                 # GitHub App client
    └── linear/                 # Linear API client
```

### 3.4 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 语言 | Go 1.24+ | 与 monorepo 一致 |
| Web 框架 | go-zero | 与其他服务一致 |
| 数据库 | MySQL (GORM) | 复用现有 DB 基础设施 |
| 配置中心 | Nacos | 复用现有，存储敏感配置 |
| GitHub 集成 | GitHub App + go-github/v68 | 读权限，无需 PAT |
| K8S 部署 | Rancher REST API | 复用现有部署模式 |
| 通知 | 飞书 Webhook | sodex-biz 已有集成模式 |
| Linear 集成 | Linear GraphQL API | 查询 Issue 信息 |
| 日志 | infra-sdk-go (ES) | 复用现有日志体系 |

---

## 四、模块详细设计

### 4.1 GitHub Webhook 接收（D1/D2）

#### 监听事件

| GitHub 事件 | 触发场景 | 处理逻辑 |
|-------------|---------|----------|
| `workflow_run.completed` | Actions 构建完成 | 提取 image tag → 触发自动部署 |
| `pull_request.closed` (merged=true) | PR 合入主线 | 释放该分支绑定的 preview 环境 |

#### GitHub App 权限

| 权限 | 级别 | 用途 |
|------|------|------|
| `actions` | read | 读取 workflow run 和 artifacts |
| `pull_requests` | read | 读取 PR 信息（分支名、作者） |
| `contents` | read | 读取 commit 信息 |

#### Webhook 处理流程

```
POST /webhook/github
    ↓
验证 Webhook Secret (HMAC-SHA256)
    ↓
解析事件类型
    ├── workflow_run.completed
    │   ├── 提取: branch, commit SHA, env_name, conclusion
    │   ├── conclusion != "success" → 忽略
    │   ├── env_name == "preview" → 触发自动部署
    │   └── env_name == "mainnet/testnet" → 仅通知，不自动部署
    │
    └── pull_request.closed (merged)
        ├── 提取: head branch
        ├── 查询该分支绑定的 preview 环境
        └── 触发环境释放
```

### 4.2 部署引擎（D1）

#### 自动部署流程

```
接收构建完成事件
    ↓
查询/分配 preview 环境（见 4.3）
    ↓
构造镜像地址: {ECR}/preview/sodex-web:{SHA}
    ↓
调用 Rancher API (PATCH Deployment)
    ↓
轮询 rollout 状态（每 8s，最多 5min）
    ↓
部署成功 → 更新 DB 记录 → 触发通知
部署失败 → 重试 1 次 → 仍失败则通知告警
```

#### Rancher API 调用

```
PATCH /k8s/clusters/{CLUSTER_ID}/apis/apps/v1/namespaces/sodex-frontend/deployments/{preview-XX}

Header:
  Authorization: Bearer {RANCHER_TOKEN}
  Content-Type: application/strategic-merge-patch+json

Body:
  {
    "spec": {
      "template": {
        "spec": {
          "containers": [{
            "name": "container-0",
            "image": "{ECR}/preview/sodex-web:{SHA}"
          }]
        }
      }
    }
  }
```

#### 配置项（通过 Nacos 管理）

```yaml
Rancher:
  Url: "https://rancher-dev.sodex.io"
  Token: "token-xxx:xxx"       # Nacos 加密存储
  ClusterId: "c-728ts"
  Namespace: "sodex-frontend"
  Container: "container-0"

ECR:
  Registry: "110427924033.dkr.ecr.ap-northeast-1.amazonaws.com"

Deploy:
  PollInterval: 8              # 秒
  PollTimeout: 300             # 秒（5分钟）
  RetryCount: 1
```

### 4.3 环境自动分配与释放（D3/D6）

#### 分配策略

```
请求分配 preview 环境（传入 branch）
    ↓
1. 该分支是否已绑定环境？ → 复用
    ↓ 否
2. 是否有空闲环境（preview-01~07）？ → 分配
    ↓ 否
3. LRU：选择最久未部署的环境 → 抢占（通知原分支owner）
```

- preview-01~07：自动分配池
- preview-08~10：手动保留，不参与自动分配

#### 释放策略

| 触发条件 | 动作 |
|---------|------|
| PR merged to mainnet | 释放该分支绑定的环境 |
| PR closed (未合并) | 释放该分支绑定的环境 |
| 手动释放 API | 管理员主动释放 |
| 超时未更新（可选，如 7 天） | 自动释放 + 通知 |

#### 释放操作

将 K8S Deployment 副本数缩为 0（而非删除 Deployment）：

```
PATCH .../deployments/preview-XX
Body: { "spec": { "replicas": 0 } }
```

### 4.4 资源记录存储（D4）

#### 数据库表设计

```sql
-- 环境表
CREATE TABLE deploy_environments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(32)  NOT NULL UNIQUE,  -- preview-01 ~ preview-10
    type        VARCHAR(16)  NOT NULL,         -- auto / manual
    status      VARCHAR(16)  NOT NULL DEFAULT 'idle',  -- idle / occupied
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始数据
INSERT INTO deploy_environments (name, type) VALUES
('preview-01', 'auto'), ('preview-02', 'auto'), ('preview-03', 'auto'),
('preview-04', 'auto'), ('preview-05', 'auto'), ('preview-06', 'auto'),
('preview-07', 'auto'), ('preview-08', 'manual'), ('preview-09', 'manual'),
('preview-10', 'manual');

-- 分配记录表
CREATE TABLE deploy_allocations (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    env_id          BIGINT       NOT NULL,
    branch          VARCHAR(256) NOT NULL,
    commit_sha      VARCHAR(64)  NOT NULL,
    image_tag       VARCHAR(128) NOT NULL,
    deployed_by     VARCHAR(128),              -- GitHub 用户名
    linear_issue_id VARCHAR(64),               -- SOD-97 等
    deploy_url      VARCHAR(256),              -- https://preview-XX.sodex.io
    status          VARCHAR(16)  NOT NULL DEFAULT 'deploying',  -- deploying / success / failed / released
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at     TIMESTAMP    NULL,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (env_id) REFERENCES deploy_environments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_alloc_branch ON deploy_allocations(branch);
CREATE INDEX idx_alloc_status ON deploy_allocations(status);
CREATE INDEX idx_alloc_env_status ON deploy_allocations(env_id, status);
```

### 4.5 通知推送（D5）

#### 飞书消息模板

**部署成功**：
```
✅ Preview 部署成功

分支: feat/addapikey-sod-97
环境: preview-03
地址: https://preview-03.sodex.io/trade/spot/BTC_USDC
提交: cf27641 - "feat(apiKey): separate key names for web/mobile/qrcode"
需求: SOD-97 - 实现自动化部署
操作: 自动部署（Actions 构建完成触发）
@张三
```

**部署失败**：
```
❌ Preview 部署失败

分支: feat/xxx
环境: preview-05
错误: 部署超时（5分钟），Pod 未就绪
提交: abc1234
请检查: GitHub Actions 构建日志 / Rancher Pod 状态
@张三
```

**环境释放**：
```
🔄 Preview 环境已释放

环境: preview-03 → 空闲
原因: 分支 feat/addapikey-sod-97 已合入 mainnet
```

**环境抢占**：
```
⚠️ Preview 环境被抢占

环境: preview-02
原分支: feat/old-feature (@李四)
新分支: feat/new-feature (@王五)
原因: 无空闲环境，抢占最久未更新的环境
```

#### Linear Issue 解析

从分支名提取 Issue ID：
```
feat/addapikey-sod-97  →  SOD-97
fix/sod-123-bug-fix    →  SOD-123
```

正则：`(?i)(sod-\d+)`

通过 Linear GraphQL API 查询 Issue 标题：
```graphql
query {
  issue(id: "SOD-97") {
    title
    url
    assignee { name }
  }
}
```

### 4.6 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/webhook/github` | GitHub Webhook 接收 |
| POST | `/api/deploy` | 手动触发部署 |
| POST | `/api/env/release` | 手动释放环境 |
| GET  | `/api/env/list` | 查询所有环境状态 |
| GET  | `/api/env/:name` | 查询单个环境详情 |
| GET  | `/api/deploy/history` | 部署历史记录 |
| GET  | `/health` | 健康检查 |

---

## 五、前置准备

| 序号 | 事项 | 负责人 | 说明 |
|------|------|--------|------|
| 1 | 创建 GitHub App | 后端 | 配置 `actions:read`、`pull_requests:read`、`contents:read` 权限，设置 Webhook URL |
| 2 | MySQL 数据库 | 运维/后端 | 创建 `deploy` 数据库，执行初始化 SQL |
| 3 | Nacos 配置 | 后端 | 添加 `deploy.yaml` 配置（Rancher Token、GitHub App 密钥等） |
| 4 | 飞书 Webhook | 运维 | 创建部署通知群机器人，获取 Webhook URL |
| 5 | Linear API Token | 后端 | 创建 Personal API Key 或 OAuth App |
| 6 | Rancher Token 迁移 | 后端 | 将现有 Token 从本地 `const.sh` 迁移到 Nacos |
| 7 | GitHub Actions 更新 | 前端 | `build.yml` 构建完成后触发 Webhook（已通过 GitHub App 自动推送） |
| 8 | DNS / 网络 | 运维 | 确保 deploy 服务可访问 Rancher API（内网或 VPN） |

---

## 六、实施路径

### Phase 1 — 核心部署（1-2 周）
- [ ] 搭建 `sodex-deploy` 服务骨架
- [ ] 实现 GitHub Webhook 接收和验证
- [ ] 实现 Rancher API 部署引擎
- [ ] 实现环境分配（基础版：手动指定环境）
- [ ] 部署到 K8S

### Phase 2 — 自动化（1 周）
- [ ] 实现环境自动分配（LRU 策略）
- [ ] 实现 PR merge 后自动释放
- [ ] 资源记录持久化（MySQL）

### Phase 3 — 通知集成（1 周）
- [ ] 飞书部署通知
- [ ] Linear Issue 关联和推送
- [ ] @人员功能（GitHub 用户 → 飞书用户映射）

### Phase 4 — 完善（按需）
- [ ] 环境超时自动释放
- [ ] 部署 Dashboard（可接入 sodex-admin）
- [ ] 手动部署 API（替代本地脚本）
- [ ] 部署回滚功能

---

## 七、现有部署脚本参考

以下文件包含可复用的部署逻辑：

| 文件 | 内容 |
|------|------|
| `soso-kit/.claude/kit/deploy/const.sh` | Rancher 配置常量 |
| `soso-kit/.claude/kit/deploy/scripts/deploy.sh` | 基础部署流程（Rancher API 调用、轮询） |
| `soso-kit/.claude/kit/deploy/scripts/run.sh` | 完整部署流程（环境查询、构建检查、部署验证） |
| `sodex-web/.github/workflows/build.yml` | GitHub Actions 构建流程 |
| `sodex-web/Dockerfile` | 镜像构建（Node → Nginx 多阶段） |

---

## 八、安全考量

| 风险 | 缓解措施 |
|------|---------|
| Rancher Token 泄露 | 存储在 Nacos 加密配置，不进代码仓库 |
| Webhook 伪造 | GitHub Webhook Secret HMAC-SHA256 验证 |
| 未授权部署 | 手动部署 API 需认证（复用 sodex-auth JWT） |
| 环境误释放 | 释放操作缩副本数为 0（非删除），可快速恢复 |
| GitHub App 密钥 | Private Key 存 Nacos，运行时加载 |
# Native Transfer 轮询优化：detected 接口替代直接轮询

## 背景与目的

当前 `NativeTransferPolling` 每 15s（常态）或 3s（boost）直接调用 `combined_transfers` 重接口获取完整划转记录列表。该接口负载较重，大部分轮询周期内并无新记录，造成不必要的 API 开销。

后端新增了轻量级 `/chain/transfer/detected` 接口，只返回 `{ latestBlockNumber }`，可用于判断是否有新链上记录。本次优化将轮询策略改为：先用 detected 轻接口检测，有变化时才调 combined_transfers。

## 选定方案

**方案 A：原地改造** — 在现有 `NativeTransferPolling` 类内部重构，移除 boost/unboost 动态频率逻辑，`loop()` 改为调 detected → 条件触发 combined_transfers。

**核心理由**：
1. 改动集中在一个文件，外部调用方几乎不变
2. 副作用小，模块封装不变
3. detected 接口统一 3s 轮询，足够轻量，不再需要动态频率

## 设计概要

### 核心流程

```
1. start(address) → 首次调 combined_transfers → 初始化 knownTxHashes + 缓存 blockNumber
2. loop (每3s)：
   a. 调 detected 接口 → 获取 latestBlockNumber
   b. latestBlockNumber > cachedBlockNumber？
      → YES：调 combined_transfers → 处理新记录(toast/事件) → 更新 cachedBlockNumber
      → NO：跳过，等下次
3. stop() → 清理 timer 和状态
```

### 类结构变更

| 项目 | 移除 | 新增 | 保留 |
|------|------|------|------|
| 属性 | `boosted`, `remainingFastPolls` | `cachedBlockNumber: number` | `knownTxHashes`, `notifiedTxHashes`, `timer`, `currentAddress`, `stopped`, `runId`, `onNewRecord` |
| 方法 | `boost()`, `unboost()`, `getInterval()` | `detectNewBlock()` | `start()`(改为async首次加载), `stop()`, `addNotifiedTxHash()`, `poll()`(末尾更新blockNumber), `loop()`(改为调detect), toast/storage 相关方法全部保留 |
| 常量 | `FAST_INTERVAL`, `NORMAL_INTERVAL`, `UNBOOST_FAST_COUNT` | `DETECT_INTERVAL = 3000` | `POLL_PAGE_SIZE`, `TOAST_TIME_WINDOW`, `STORAGE_KEY_PREFIX`, `STORAGE_TTL` |

### 新增 HTTP 接口

```typescript
// src/http/user/index.ts
export const getTransferDetected = (walletAddress: string) => {
  return request<{ walletAddress: string; latestBlockNumber: number }>(
    `/chain/transfer/detected`,
    { method: "GET", params: { wallet_address: walletAddress }, baseURL: BASE_API_SERVER_URL }
  );
};
```

### blockNumber 更新逻辑

- 首次从 `combined_transfers` 返回的 `fundTransfers` 中取 `Math.max(...blockNumber)`
- 空列表时 `cachedBlockNumber = 0`
- 每次 `poll()` 成功后更新为返回记录中的最大 blockNumber

## 边界与约束

**包含：**
- 移除 boost/unboost 动态频率逻辑
- 新增 detected 轻接口轮询
- blockNumber 缓存和比较机制
- 首次加载初始化

**不包含：**
- 不改变 toast 通知逻辑
- 不改变 eventBus 事件机制
- 不改变 localStorage 持久化逻辑
- 不改变 `addNotifiedTxHash` 接口

**已知限制：**
- detected 接口失败时静默跳过，依赖下次 3s 重试
- `start()` 变为 async，但外部调用方无需 await（内部自行启动 loop）

## 集成点

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/hooks/useNativeTransferPolling.ts` | 重构 | 核心改造：移除 boost/unboost，新增 detected 轮询 + blockNumber 缓存 |
| `src/http/user/index.ts` | 新增函数 | `getTransferDetected` 接口 |
| `src/http/user/api.d.ts` | 新增类型 | `TransferDetected` namespace |
| `src/pages/_components/deposit/DepositStepByStep.tsx` | 移除代码 | 删除 boost/unboost useEffect 及相关 import |
| `src/components/baseInfoRequester/index.tsx` | 无变化 | `start`/`stop` 接口不变 |
| `src/pages/_components/withdraw/WithdrawModal.tsx` | 无变化 | `addNotifiedTxHash` 保留 |
| `src/models/spotOrder.ts` | 无变化 | `addNotifiedTxHash` 保留 |

## 验收标准

- [ ] `NativeTransferPolling` 不再包含 `boost()`、`unboost()`、`getInterval()` 方法
- [ ] `FAST_INTERVAL`、`NORMAL_INTERVAL`、`UNBOOST_FAST_COUNT` 常量已移除
- [ ] `DepositStepByStep.tsx` 不再引用 `nativeTransferPolling`
- [ ] 新增 `getTransferDetected` HTTP 接口函数和类型定义
- [ ] `start()` 首次调用 `combined_transfers` 并缓存 blockNumber
- [ ] `loop()` 每 3s 调 detected 接口，仅在 blockNumber 变化时调 `combined_transfers`
- [ ] `poll()` 成功后更新 `cachedBlockNumber` 为记录中最大 blockNumber
- [ ] toast 通知、eventBus 事件、localStorage 持久化逻辑不受影响
- [ ] `addNotifiedTxHash` 接口保留且正常工作

## 验收场景

### 场景 1：首次加载正常初始化
- **Given** 用户钱包已连接，地址为 `0xc014...D76b`，链上有 5 条 native_transfer 记录，最新记录 blockNumber = 7212884
- **When** `baseInfoRequester` 调用 `nativeTransferPolling.start(address)`
- **Then** 调用一次 `combined_transfers`，`cachedBlockNumber` 被设置为 7212884，`knownTxHashes` 包含 5 条记录的 txHash，随后启动 detected 轮询

### 场景 2：detected 检测到新区块
- **Given** `cachedBlockNumber = 7212884`，轮询已启动
- **When** detected 接口返回 `{ latestBlockNumber: 7212890 }`
- **Then** 调用 `combined_transfers` 获取新记录，处理后 `cachedBlockNumber` 更新为 7212890，新记录触发 toast 通知和 `DEPOSIT_RECORD_REFRESH` 事件

### 场景 3：detected 无变化时不调重接口
- **Given** `cachedBlockNumber = 7212884`，轮询已启动
- **When** detected 接口返回 `{ latestBlockNumber: 7212884 }`（与缓存相同）
- **Then** 不调用 `combined_transfers`，3s 后继续下一次 detected 检查

### 场景 4：首次加载无记录
- **Given** 用户钱包已连接，链上无任何 native_transfer 记录
- **When** `nativeTransferPolling.start(address)` 执行
- **Then** `combined_transfers` 返回空列表，`cachedBlockNumber = 0`，随后 detected 返回任何 `latestBlockNumber > 0` 都会触发 `combined_transfers`

### 场景 5：detected 接口请求失败
- **Given** 轮询已启动，`cachedBlockNumber = 7212884`
- **When** detected 接口网络超时或返回错误
- **Then** 静默跳过（console.error），3s 后重试，不影响 `cachedBlockNumber`

### 场景 6：快速切换钱包地址
- **Given** 地址 A 的轮询正在进行中
- **When** 用户切换到地址 B，触发 `start(addressB)`
- **Then** 地址 A 的轮询通过 `runId` 机制被废弃，地址 B 重新初始化（首次 combined_transfers + 新 blockNumber）

---

## 更新记录

- 2026-04-17 初始版本
