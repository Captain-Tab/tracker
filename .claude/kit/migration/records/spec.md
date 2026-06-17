# spec

跨迁移的 **spec 阶段假设 / 误判** 类坑。

---

## analyze:working-code-over-spec-as-ground-truth

- **tags**: analyze, spec, ground-truth, commented-code, doc-vs-code
- **severity**: high（spec 写错会导致整个 execute 阶段产出错误实现）
- **created**: 2026-04-24
- **source**: sodex-web → sodex-next vault-deposit value chain staking/token 地址错误

### 触发场景

迁移任何有**设计文档 / spec 文档 / guide 文档**的功能时，文档描述的是**设计意图**，但老项目的**实际运行代码**已经做了删减、注释或修改。迁移时照文档迁移，写出了老项目已废弃的逻辑。

### 典型症状

- 新项目代码逻辑比老项目"多一步"（extra staking step）
- 使用了老项目已不再使用的 token 地址（vsMAG7 vs vMAG7）
- 偶发成功、偶发 `code=-1`，难以稳定复现
- Spec checklist 里标的地址/参数与老项目运行代码不一致

### 本次根因（vault deposit staking 错误）

`vault-deposit-guide.md` 和 `interaction-spec.md` 描述：`isStake=true` 时需要 external staking（vMAG7 → vsMAG7），permit 目标 token 为 vsMAG7。

但老项目 `useNewValueChainDeposit.tsx` **步骤2** 把 staking 全部注释掉，并且：

```ts
// 步骤2: 注释 staking 相关
// isStake=true → depositTokenAddress = VMAG7_TOKEN_ADDRESS（用 vMAG7，不是 vsMAG7）
const depositTokenAddress = isStake ? VMAG7_TOKEN_ADDRESS : VSMAG7_TOKEN_ADDRESS;
```

文档记录的是"设计意图"，代码实现的是"vault 合约内部处理 staking，前端不做"。**以文档为准导致新项目多了一步 external staking，permit token 也用错了。**

同理，`signing-checklist.md` 写 `to=VAULT_CALLER_ADDRESS`，但老项目实际用 `to=SLP_TOKEN_ADDRESS`。文档写错了，但写错后代码继续跑通的是 `SLP_TOKEN_ADDRESS`。

### 规则

> **文档 < 实际可运行的老项目代码**
>
> 文档记录意图，代码体现决策。遇到冲突时，老项目能跑通的代码是 ground truth。

具体优先级：

| 信息来源 | 可信度 | 备注 |
|---|---|---|
| 老项目**实际运行代码**（非注释行）| ✅ 最高 | 这是 ground truth |
| 老项目**注释掉的代码** | ⚠️ 中（已废弃） | 记录了设计意图，但不是当前实现 |
| **migration spec / guide 文档** | ⚠️ 中（可能滞后）| 基于意图写，可能未跟代码同步 |
| **signing-checklist / interaction-spec** | ⚠️ 中（有误差） | 同上，可能有笔误 |
| AI 生成的推断 | ❌ 最低 | 未验证前不可信 |

### 避坑动作

Analyze 阶段对每个关键参数（token 地址、to 地址、步骤列表）**强制以代码为准**：

```bash
# 1. 直接 grep 老项目对应 hook 的关键变量
grep -n "depositTokenAddress\|tokenAddress\|to:\|vaultAddress\|isStake" <legacy-hook>

# 2. 对注释掉的代码段，明确记录"已废弃，不迁移"
# 3. 文档中的地址/参数，核查老项目实际传值
grep -n "VMAG7_TOKEN_ADDRESS\|VSMAG7_TOKEN_ADDRESS\|SLP_TOKEN_ADDRESS\|VAULT_CALLER" <legacy-hook>
```

**Spec 模板强制问**：

```
Q: 以下参数是否与老项目实际代码核对过（不是文档）？
  - permit token 地址: 老项目实际用 ___（grep 结果）
  - to 地址: 老项目实际用 ___（grep 结果）
  - 步骤列表: 老项目是否有注释掉的步骤？___
→ 有注释掉的步骤 = 不迁移该步骤
→ 地址与文档不一致 = 以代码为准
```

### 检测建议

Execute 阶段前，对每个 `to` / `tokenAddress` / `cmdData` 参数，运行：

```bash
grep -n "tokenAddress\|to:\|vaultAddress" <old-project-hook> | grep -v "^.*//.*"
# 过滤注释行，只看实际赋值
```

结果与 spec 不一致时，**暂停 execute，回 spec 修正**，不进入 plan 阶段。

### 关联

- `chain-call:callForPermit-cmdType-to-address-mapping`（同属 to 地址错误，两者叠加）
- `spec:permit-assumption-trap`（同属 spec 阶段凭文字推断犯错，不凭代码核实）

---

## spec:permit-assumption-trap

- **tags**: spec, clarify, permit, callForPermit, assumption
- **severity**: high(错假设会导向错架构,整批 callForPermit 类模块都可能中招)
- **created**: 2026-04-22
- **source**: sodex-next vault-claim clarify Q3 回溯修正

### 触发场景

迁移**任意 callForPermit 类签名操作**(vault claim / unstake / withdraw / deposit / trade deposit / trade withdraw)的 spec 时,基于"UI 看起来简单 / 动作语义单步"就假设**不需要 permit**,把 Service 写成"直接 wagmi writeContract"。

### 典型症状

- Spec §Service 写 `executeClaim` / `executeUnstake` 等,描述为"直接 wagmi writeContract"
- Infra 层只设计 `waitForTransactionReceipt`,**无 signTypedData**
- Plan 阶段沿用,execute 开工后发现老项目实际用 `useCallForPermit.createBridgeCallFor` / `createBridgeCallForWithdraw` 等,链路必须经过 **EIP-712 签名 + 后端 `/biz/mirror/call_for_permit` 代理**

### 根因

"操作复杂度"和"signing 复杂度"是**两件事**:
- UI 复杂度:claim/unstake 表单极简(一个金额 + 确认),容易误以为"Service 也简单"
- 合约层:**所有 ValueChain CallForPermit 类合约**都要求 EIP-712 `CallForPermit` wrapper(nonce+deadline)签名。前端不是直接链上 writeContract,而是签名后走后端代理

整套 spot/vault 生态的 **"链下签名 → 后端代理上链"** 模式是统一的,不能按 UI 简繁区分。

### 避坑动作

Spec 阶段**强制检查老项目对应代码**里是否含以下其中一项:

```bash
# 老项目 grep
grep -rnE "useCallForPermit|createBridgeCallFor|signTypedData.*CallForPermit" <legacy-module>
```

任一命中 → spec 必须保留 permit 链路。禁止"UI 简单 = 无 permit"推断。

**Spec 模板建议加一个强制问**:

```
Q: 本模块的签名链路是什么?
  A. 直接 wagmi writeContract(链上 tx,无后端代理)
  B. EIP-712 permit 签名 + 后端代理上链(老项目 useCallForPermit 模式)
  C. 其他(说明)
→ 选 B 的必须保留 permit + signCallForPermit + postCallForPermit + waitReceipt 完整链路
```

clarify Q3 式的回溯检查(让用户从老项目代码确认)是此坑的最好防线。

### 检测建议

Spec 生成后,**对每个签名模块**核查 spec §Service 段:

- 是否出现 `signTypedData` / `signCallForPermit` / `buildPermitTypedData` / `CallForPermit` 关键词
- 是否提到 `postCallForPermit` 或等效 HTTP POST 后端代理
- 是否列出 `CallForPermit` 的 cmd 类型(`CreateBridgeCallFor` / `DepositERC20WithPermit` / `WithdrawToken` 等)

缺失任一 → 怀疑走了 "无 permit 简化版" 误判,回查老项目。

### 本次来源

vault-claim 首版 spec 写 "claim 最简单签名模块,直接 wagmi writeContract"。clarify 阶段 Q3 核对老项目 `sodex-web/src/pages/vault/components/modals/funding/claim/index.tsx:82-91`:

```ts
const data = await createBridgeCallFor({
  chain: "BASE_ETH",
  callForType: 2,
  ...
});
```

`createBridgeCallFor` 内部是 `useCallForPermit` 的 EIP-712 签名 + HTTP POST。修正 spec 加"**背景决策(2026-04-22 clarify)**"段,明确 permit 链路保留。

### 关联

- 对齐 records/api-contract.md `api-contract:baseURL-naming`(同属 API 契约对齐类)
- 对齐 records/layering.md `structure:service-needs-domain-not-container-logic`(permit typed data 构造函数最终归 domain)
