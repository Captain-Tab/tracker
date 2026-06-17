# Vault 模块 0 — 环境配置(env)

**抓取来源**:`sodex-web/src/config/contracts.ts` + `sodex-web/src/pages/vault/constant.ts`
**抓取时间**:2026-04-20
**状态**:⏳ 待用户确认

---

## 1. 网络环境

| 网络 | Chain ID | 说明 |
|---|---|---|
| ValueChain mainnet | 286623 | 核心合约部署链(已在 `shared/constants/chains.ts`) |
| ValueChain testnet | 138565 | 测试网(已在 `shared/constants/chains.ts`) |
| Base mainnet | 8453 | cooldown / user-to-account 查询 |

⚠️ 旧项目 `contracts.ts` 对 vault 相关地址**未做 mainnet / testnet 区分**(只有 `BATCH_QUERY_ADDRESS` 按 `__IS_TESTNET__` 切换)。
→ 本次迁移 **只引入 mainnet 地址**,testnet 地址空缺,待需要时另行确认。

---

## 2. Vault 合约地址(ValueChain mainnet)

> 旧项目集中在 `src/config/contracts.ts` 的 `VALUE_CHAIN_CONTRACTS` + `LEGACY_CONTRACT_ADDRESSES`

| 用途 | 旧项目常量名 | 地址 | 复用 shared 既有? |
|---|---|---|---|
| **Vault 调用者**(主 caller) | `VAULT_CALLER_ADDRESS` | `0x478FeC6b6EAD70D0e03BEeBa15027Aa6D51180Ab` | 新增 `VAULT_CALLER_ADDRESS` |
| **CallForPermit**(签名主合约) | `VAULT_CALL_FOR_PERMIT_ADDRESS`(实际 = `SODEX_TOKEN_CALL_FOR_PERMIT`) | `0x890B7D142841065E64E5f94a455876e6352A7801` | ✅ 已在 `CALL_FOR_PERMIT_ADDRESS`,vault 直接复用 |
| **vMAG7 Token**(输入 token) | `VMAG7_TOKEN_ADDRESS` | `0x3887A01Af83E53c960469d60908DEB83748f22FB` | 新增 `VMAG7_TOKEN_ADDRESS` |
| **vsMAG7 Token**(输出 token) | `VSMAG7_TOKEN_ADDRESS` | `0xa17B0537af8687080B7bFAa8C5EEA4EcD6481870` | 新增 `VSMAG7_TOKEN_ADDRESS` |
| **SLP Token** | `SLP_TOKEN_ADDRESS` | `0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876` | 新增 `SLP_TOKEN_ADDRESS` |
| **NAV 合约** | `NAV_CONTRACT` | `0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876` | 与 SLP 同址,标注注释即可 |
| **PreviewRedeem 合约** | `PREVIEW_REDEEM_CONTRACT` | `0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876` | 与 SLP 同址,标注注释即可 |

## 3. Base chain 合约(Chain ID: 8453,unstake cooldown 走 base)

| 用途 | 旧项目常量名 | 地址 |
|---|---|---|
| **Cooldown 查询** | `COOLDOWN_INFOS` | `0x3d8f0ddb4bb9332Cb89dEC22d273d9be1a91530b` |
| **UserToAccount**(代理钱包查询) | `USER_TO_ACCOUNT` | `0xe5C7bbeEFb207BaA5BddbbDf14eb846D0a11223f` |

⚠️ Base chain ID(8453)目前不在新项目 `shared/constants/chains.ts`。模块 0 需要:
- (a) 确认 Base 是否已接入 `@/lib/walletConfig`
- (b) 若未接入,模块 4 unstake 前补齐

---

## 4. Token 符号与精度

| Token | Symbol | 链上精度(decimals) | 说明 |
|---|---|---|---|
| vMAG7 | `vMAG7.ssi` | 8 | 输入 token |
| vsMAG7 | `vsMAG7.ssi` | 8 | 输出 token |
| vsMAG7 SLP | `vsMAG7.SLP` | 8 | LP 代币 |

**UI 精度常量**(旧项目 `vault/constant.ts`):
- `DEFAULT_DECIMAL = 4`
- `DEFAULT_MINIMUM_DECIMAL = 2`
- `TOKEN_DECIMAL = 8`

→ 这些作为 vault UI 常量,模块 0 放入 `features/vault/constants.ts`。

---

## 5. ABI 来源(旧项目 `public/abi/`)

| 合约 | ABI 文件路径 |
|---|---|
| VAULT_CALLER | `/abi/SoDexTokenCaller.json` |
| CallForPermit | `/abi/SoDexTokenCallForPermit.json` |
| NAV | `/abi/NavAbi.json` |
| PreviewRedeem | `/abi/PreviewRedeemAbi.json` |
| Cooldown | `/abi/CooldownInfosAbi.json` |
| UserToAccount | `/abi/UserToAccountAbi.json` |

模块 0 **不迁移 ABI**(按约定模块 2 才用)。模块 2 开工时 copy 最小 ABI 片段到 `features/vault/infra/chain/vaultInfra.ts` 顶部。

---

## 6. 新项目写入方案

**`src/shared/constants/contracts.ts` 追加段**:

```ts
// Vault 合约(ValueChain mainnet)
export const VAULT_CALLER_ADDRESS =
  "0x478FeC6b6EAD70D0e03BEeBa15027Aa6D51180Ab" as const;
export const VMAG7_TOKEN_ADDRESS =
  "0x3887A01Af83E53c960469d60908DEB83748f22FB" as const;
export const VSMAG7_TOKEN_ADDRESS =
  "0xa17B0537af8687080B7bFAa8C5EEA4EcD6481870" as const;
export const SLP_TOKEN_ADDRESS =
  "0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876" as const;

// NAV / PreviewRedeem 与 SLP 同址,直接复用 SLP_TOKEN_ADDRESS
// (旧项目 NAV_CONTRACT / PREVIEW_REDEEM_CONTRACT 都是 0x368788...)

// Base chain(Chain ID: 8453,unstake cooldown 用)
export const VAULT_COOLDOWN_INFOS_ADDRESS =
  "0x3d8f0ddb4bb9332Cb89dEC22d273d9be1a91530b" as const;
export const VAULT_USER_TO_ACCOUNT_ADDRESS =
  "0xe5C7bbeEFb207BaA5BddbbDf14eb846D0a11223f" as const;
```

**注意**:CallForPermit 复用已有 `CALL_FOR_PERMIT_ADDRESS`(`contracts.ts:6`),不重复定义。

---

## 7. 待用户确认项

- [ ] 确认只迁移 mainnet 地址,testnet 暂空(旧项目亦未区分)
- [ ] 确认 NAV / PreviewRedeem 直接复用 `SLP_TOKEN_ADDRESS`(同址)
- [ ] 确认 Base chain(8453)的 cooldown / userToAccount 地址
- [ ] 确认 `@/lib/walletConfig` 是否已包含 Base 8453

用户回复 **Y** 即可进入批次 2;有歧义请在上方清单勾选并补充。
