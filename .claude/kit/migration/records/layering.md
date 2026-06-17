# layering

跨迁移的 **分层/归属决策** 类坑。

---

## structure:feature-vs-shared-const

- **tags**: structure, constants, layering
- **severity**: medium
- **created**: 2026-04-22
- **source**: sodex-web → sodex-next vault `VAULT_TOKEN_DECIMAL`

### 触发场景

迁移 / 新增常量时，判断放 `shared/constants/*` 还是 `features/<X>/constants.ts`。

### 典型症状

- 业务语义常量误放入 `shared/constants/contracts.ts`
- `features/<X>/constants.ts` 被误删，常量"合并迁移"到 shared
- feature 间共享常量导致耦合扩散

### 根因

"常量"覆盖两种不同性质的值，AI 容易混：

| 性质 | 举例 | 归属 |
|---|---|---|
| 协议事实 | 合约地址、ABI、chain ID | `shared/constants/contracts.ts` |
| 业务语义 | token 展示精度、枚举、符号 | `features/<X>/constants.ts` |

### 避坑动作

新增常量前问两个问题：

1. 这个值是**协议事实**还是**业务决策**？
2. 会被几个 feature 使用？

决策表：

| 性质 | 使用范围 | 归属 |
|---|---|---|
| 协议事实 | 跨 feature | `shared/constants/contracts.ts` |
| 业务语义 | 单 feature | `features/<X>/constants.ts` |
| 业务语义 | 跨 feature | `shared/constants/<businessDomain>.ts`（新建，**不混入** contracts） |

### 检测建议

verify 阶段 grep：

```bash
grep "export const" src/shared/constants/contracts.ts | grep -E "_DECIMAL|_SYMBOL|_DEFAULT"
```

命中 → 考虑下放到 feature。

### 本次来源

sodex-next `VAULT_TOKEN_DECIMAL` / `VAULT_DISPLAY_DECIMAL` 被误迁到 `shared/constants/contracts.ts`，原 `features/vault/constants.ts` 被删。修复：恢复 feature 层 `constants.ts`，业务常量下放，contracts 仅保留合约地址。

### 补充:feature 根文件会被 ESLint boundaries 标 unknown

ESLint `boundaries/elements` 只匹配 `src/features/*/infra|domain|services|containers|stores|components|pages/**` 子目录,**feature 根文件**(如 `features/vault/constants.ts`)不属于任何 elementType,在严格模式(`checkUnknownLocals`)下会报 `no-unknown`。

修复:把根文件下放到某个子目录(常量通常入 `domain/constants.ts`),或调整 boundaries 规则。本项目当前规则严格 → **新增 feature 级文件优先放子目录**,别放 feature 根。

---

## structure:infra-cannot-import-domain

- **tags**: structure, layering, boundaries
- **severity**: medium
- **created**: 2026-04-22
- **source**: sodex-next vault-claim `vaultClaimInfra.ts` 重构

### 触发场景

写 infra 层代码(`infra/chain/*` / `infra/rpc/*` / `infra/api/*`)时,想直接 import `domain/types.ts` 里的业务类型或错误类型,图省事 / DRY。

### 典型症状

ESLint 报:
```
No rule allowing dependencies from elements of type "infra" to elements of type "domain"
```

### 根因

CLAUDE.md §2 规则:

| 层 | 允许 import |
|---|---|
| infra/ | shared |
| domain/ | infra(仅 `import type`,normalize.ts 例外 #1)、shared |

**infra → domain 反向**被禁。分层意图:infra 是外部系统适配层,不承载业务语义;domain 才是业务事实源。允许 infra 依赖 domain 会让外部协议变更牵动业务层。

### 避坑动作

- infra 要用的**错误类型** → 放 `infra/errors.ts`(文件命名速查已列),不放 `domain/types.ts`
- infra 要用的**数据结构**(如 EIP-712 typed data) → 定义本地泛型(`type TypedDataInput`),不 import domain 版本
- 若某类型"infra 和 domain 都要用",优先看归属——通常**业务语义强 = domain 归属 + domain 暴露**,infra 复制本地结构

### 检测建议

ESLint boundaries 会自动拦。

### 本次来源

vault-claim execute 初版 `infra/chain/vaultClaimInfra.ts` 里 `import type { CallForPermitTypedData, VaultInfraError } from "../../domain/types"`。重构:VaultInfraError → `infra/errors.ts`;CallForPermitTypedData → infra 本地定义 `TypedDataInput` 泛型。

---

## structure:service-needs-domain-not-container-logic

- **tags**: structure, layering, boundaries, pure-function
- **severity**: medium
- **created**: 2026-04-22
- **source**: sodex-next vault-claim `buildPermitTypedData` 等纯函数迁移

### 触发场景

Container 的 `xxxLogic.ts` 里放了一组纯函数(`derive*` / `build*` / `decide*`),后来 Service 也想调用——发现不能 import。

### 典型症状

ESLint 报:
```
No rule allowing dependencies from elements of type "services" to elements of type "containers"
```

### 根因

CLAUDE.md §2:
| services/ | 允许 import: infra, domain, stores, shared(**禁** containers / components / pages / react) |

原则:Service 是 Command 编排层,应只依赖更底层(domain/infra)。Container 属 UI 响应层。

### 避坑动作

写纯函数时**提前判断复用范围**:

| 使用者 | 归属 |
|---|---|
| 仅 Container 自己 | `containers/xxxLogic.ts` |
| Service 也要用 | `domain/xxxLogic.ts` 或 `domain/xxx.ts`(更合适的业务语义) |
| Service + UI 都用 | `domain/xxx.ts`(Container 也能 import domain) |

**判断规则**:问"这个纯函数的输入/输出是不是**领域概念**"。如果是(EIP-712 typed data、cmd 结构编码),进 domain;如果是(按钮状态派生、helper 文案),留 containers。

### 本次来源

vault-claim `buildClaimCmd` / `buildPermitTypedData` / `buildCmdData` / `buildCallForPermitRequest` / `buildDeadlineSeconds` 初版放 `containers/claimFlowLogic.ts`;Service `vaultClaimService.ts` import 被 boundaries 拦。下沉到 `domain/claimPermit.ts`;Container 只留 `derive*` / `is*` UI 派生函数。

---

## structure:service-cross-feature-orchestration-via-container

- **tags**: structure, layering, boundaries, cross-feature, orchestration
- **severity**: high(跨 feature 业务编排的通用模式)
- **created**: 2026-04-22
- **source**: sodex-next vault-unstake `smart-transfer + permit` 双步骤编排

### 触发场景

新 feature 的 Service 需要**编排**另一个 feature 的 Service(典型:调 `trade.submitTransfer` 做 Spot→EVM 转账,再做自己的 CallForPermit 签名)。图省事想从 Service 层直接 import 另一个 feature 的 Service。

### 典型症状

ESLint 报:
```
No rule allowing dependencies from elements of type "services" to elements of type "services"(跨 feature)
```

或直接:
```
No rule allowing dependencies from elements of type "services" to elements of origin "local" with source "@/features/<other>/services/..."
```

Feature 的 `index.ts` 按 CLAUDE.md §3 只允许导出 **container hooks(`use*`开头)**、Page 组件、以及 import 只含 `containers/` + `shared/` 的 component——**services 绝对禁止导出**。

### 根因

Boundaries 规则(`eslint.config.mjs`):

```
from: { type: "services" },
allow: [
  { to: { type: "infra" } },
  { to: { type: "domain" } },
  { to: { type: "stores" } },
  { to: { type: "shared" } },
]
```

services 层不能 import 任何 feature 的 services(不允许 cross-feature services 互调)。

意图:Service 是 Command 单元,应单一职责,不做跨 feature 编排。跨 feature 业务 flow 的**编排**职责属 Container。

### 避坑动作

**本 feature Service 只做本 feature 的 Command**(签名 / HTTP / 等 receipt 等)。跨 feature 的**编排在 Container Hook 层做**,通过"mutation of mutations"模式:

```ts
// ✅ 正确:container 层两层 mutation
export function useSubmitVaultUnstake() {
  const { mutateAsync: doTransfer } = useSubmitTransfer(); // from @/features/trade(container hook,允许跨 feature 导出)
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount, evmSmag7 }) => {
      // 1. 跨 feature 调 trade 的 container hook
      if (Decimal(amount).gt(evmSmag7)) {
        const diff = ...;
        await doTransfer({ from: "Spot", to: "Funding", coin: "sMAG7.ssi", amount: diff });
        await waitForEvmSmag7Balance({ walletAddress, targetAmount: amount });
      }
      // 2. 调本 feature service
      return executeUnstakePermit({ amount, account });
    },
    ...
  });
}

// ❌ 错误:vault service 直接 import trade service
// import { submitTransfer } from "@/features/trade/services/transferService";
// boundaries 报 services→services cross-feature 禁止
```

**trade 那侧需要导出**:`trade/index.ts` `export { useSubmitTransfer }`(container hook,允许)。

### 副作用:两阶段 toast

跨 feature container hook 一般带自己的 `notify.loading/success/error`,会和本模块的 loading 叠加显示。不要强行抑制(除非必要),接受两阶段反馈(对齐老项目 UX 惯例)。

### 检测建议

Plan 阶段每条"跨 feature 流程"标注:
- 依赖哪个 feature 的什么能力 → 对应的 container hook 路径 → 该 hook 是否已 index.ts 导出

未导出的 → plan 加前置 Step(在 trade 或目标 feature 的 index.ts 里追加 export)。

### 本次来源

vault-unstake plan 原设计 `services/vaultUnstakeService.ts` 内部含 `submitTransfer()` + `waitForEvmSmag7Balance()` + CallForPermit 全流程。execute 时 boundaries 拦截 `services → @/features/trade/services/transferService` 跨 feature import。重构:

- vault service `executeUnstakePermit` 只做 CallForPermit(单一职责)
- Container `useSubmitVaultUnstake` 两层 mutation 编排:先 `await doTransfer()`(来自 `trade.useSubmitTransfer`)→ 再 `await waitForEvmSmag7Balance()`(vault infra)→ 再 `await executeUnstakePermit()`(vault service)
- `trade/index.ts` 追加 `export { useSubmitTransfer }`

后续 withdraw / deposit 若涉及同类跨 feature 编排,按本 pattern 复制。
