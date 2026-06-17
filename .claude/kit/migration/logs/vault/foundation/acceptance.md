# Vault 模块 0(vault-foundation)验收归档

**执行时间**:2026-04-20
**状态**:✅ 完成,模块 1 可启动

---

## 1. 产出清单

### 新建文件
- `src/features/vault/infra/chain/vaultInfra.ts`(占位)
- `src/features/vault/constants.ts`(UI 常量 + token 符号/精度)
- `src/features/vault/containers/dialogs/openers.ts`(5 个 stub opener)
  - 注:`containers/shared/` 目录不预建,模块 2 首次加文件时自动产生(避免 .gitkeep 噪音)
- `.claude/kit/migration/logs/vault/foundation/env.md`
- `.claude/kit/migration/logs/vault/foundation/acceptance.md`(本文件)

### 修改文件
- `src/shared/constants/contracts.ts` — 追加 6 个 vault 相关地址
- `src/shared/queryKeys/index.ts` — 追加 `vault` 命名空间

### 未改动(已就绪)
- 路由 `/vault` 在 `src/App.tsx:179` 已注册
- `src/lib/walletConfig.ts` 已含 base + valueChain,无需修改 → 无需回归测试

---

## 2. 合约地址落地(ValueChain mainnet + Base 8453)

追加到 `shared/constants/contracts.ts`:

| 常量 | 地址 | 用途 |
|---|---|---|
| `VAULT_CALLER_ADDRESS` | `0x478FeC6b6EAD70D0e03BEeBa15027Aa6D51180Ab` | vault 调用主合约 |
| `VMAG7_TOKEN_ADDRESS` | `0x3887A01Af83E53c960469d60908DEB83748f22FB` | 输入 token |
| `VSMAG7_TOKEN_ADDRESS` | `0xa17B0537af8687080B7bFAa8C5EEA4EcD6481870` | 输出 token |
| `SLP_TOKEN_ADDRESS` | `0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876` | SLP / NAV / PreviewRedeem 同址 |
| `VAULT_COOLDOWN_INFOS_ADDRESS` | `0x3d8f0ddb4bb9332Cb89dEC22d273d9be1a91530b` | Base 8453 cooldown |
| `VAULT_USER_TO_ACCOUNT_ADDRESS` | `0xe5C7bbeEFb207BaA5BddbbDf14eb846D0a11223f` | Base 8453 代理钱包 |

**CallForPermit 地址复用**:`CALL_FOR_PERMIT_ADDRESS`(旧项目 `VAULT_CALL_FOR_PERMIT_ADDRESS` = `SODEX_TOKEN_CALL_FOR_PERMIT`),不重复定义。

---

## 3. 验收门禁

- ✅ `pnpm tsc --noEmit` vault 相关 0 错(其他 2 个残留 error 在 `trade/BalancesTable.tsx`,pre-existing)
- ✅ `pnpm eslint src/features/vault/` 0 错
- ✅ 路由 `/vault` 未被改动,VaultPage 继续渲染现有骨架
- ✅ walletConfig 未修改,无需跑 spot / perps 回归
- ✅ Dialog opener 5 个可被调用,抛 `Not Implemented: vault-<module>` 明确错误
- ✅ queryKeys 新增 `vault.all()` 工厂

---

## 4. spec 偏差说明

| spec 原定 | 实际落地 | 原因 |
|---|---|---|
| `shared/queryKeys/vault.ts` 独立文件 | 追加到 `shared/queryKeys/index.ts` 的 `vault` 命名空间 | 项目约定是单文件聚合(market/spot/perps/auth 等都在 index.ts),跟随现状更合规 |
| `env` / `hardcode` 决策 | 硬编码到 `contracts.ts` | 项目既有约定,见 env.md |
| mainnet / testnet 各一套 | 仅 mainnet | 旧项目 vault 相关地址未区分环境,只有 `BATCH_QUERY` 按 `__IS_TESTNET__` 切换 |

---

## 5. 遗留给下游

**模块 2-5 可消费**:
- `shared/constants/contracts.ts` 的 6 个 vault 地址
- `shared/queryKeys/index.ts` 的 `queryKeys.vault.all()` 工厂(模块按需追加子 key)
- `features/vault/containers/dialogs/openers.ts` 5 个 stub(各模块 UI 阶段结束覆盖类型)
- `features/vault/containers/shared/` 空目录(模块 2 首次实现 `useVaultNonce` / `useCallForPermit` / `useVaultMag7Balance`)
- `features/vault/constants.ts` 的 token 符号与精度常量

**模块 2 开工时需做**:
- 在 `features/vault/infra/chain/vaultInfra.ts` 填入 ABI 片段 + `readContract` 封装(参考 `features/trade/infra/chain/permitInfra.ts`)
- 追加 `queryKeys.vault.position / claimable / nonce / ...` 子 key

---

## 6. 下游一致性扫描(补)

> 初版 finalize 漏了这步,用户指出后回补。后续模块 acceptance-template 已加入"下游一致性"门禁项。

扫描 01-06 spec 对模块 0 产物的引用,发现 3 处 P0 偏离:

| 位置 | 旧内容 | 改后 |
|---|---|---|
| 01-page.md "遗留给下游" | `vaultKeys.position` | `queryKeys.vault.position`(跟随模块 0 落地命名) |
| 01-page.md "MyPosition stub 接入" | `import ... from '../../dialogs/openers'` | `import ... from '@/features/vault/containers/dialogs/openers'` |
| 01-page.md "MyPosition stub 调用" | `openVaultDepositDialog({ /* 最小值 */ })` | `openVaultDepositDialog(undefined)`(匹配 `(input: unknown)` 签名) |

另补:
- 01-page.md §5 错误处理引用 "README §3" 改为 "CLAUDE.md §8"
- 01-page.md 前置补:现有组件状态 + 旧项目分析触发点(`/k:migration vault-page analyze`)

---

## 7. 下一步

- [x] 模块 0 finalize
- [x] 下游一致性扫描完成(修 3 处 P0)
- [ ] **模块 1(vault-page)启动**:需用户提供 VaultPage Figma 链接
- [ ] 在 `.claude/kit/migration/logs/vault/page/` 创建子目录
