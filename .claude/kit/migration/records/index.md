# Migration Records: 跨迁移方法论坑

> 记录 `/k:migration` 各阶段容易反复踩的**方法论级**坑（非项目业务坑）。
> analyze 阶段 cat 本索引注入；详情按需 `Read records/<category>.md`。

## 条目索引

| id | 分类文件 | 触发场景 | 一句话避坑 |
|---|---|---|---|
| api-contract:baseURL-naming | api-contract.md | 迁移 API 客户端，老项目有多个 `*_URL` 常量 | 查常量**实际值**，别凭名字分 client |
| structure:feature-vs-shared-const | layering.md | 新增业务语义常量（精度/枚举/符号） | 业务语义入 `features/<X>/constants.ts`，协议事实才入 `shared/constants/contracts.ts` |
| cleanup:ui-migration-stub | cleanup.md | `/k:ui-migration` Phase 1 产物接入真实数据后 | verify 前 `grep -rE "MOCK_\|Placeholder"` 清理残留 |
| ws:callForPermit-push-deferred | ws.md | 迁移 callForPermit 签名操作(claim/unstake/withdraw/deposit)的通知链路时 | 后端 `sodex_call_for` push 未启用,走手动 notify 方案,不走 WS 驱动 |
| spec:permit-assumption-trap | spec.md | 迁移 callForPermit 类签名操作的 spec 时 | 不以 UI 简繁推断有无 permit;强制核查老项目是否含 `useCallForPermit` / `createBridgeCallFor` |
| analyze:working-code-over-spec-as-ground-truth | spec.md | analyze 阶段，文档/spec 描述的参数/步骤与老项目实际代码不一致 | 文档记意图，代码是 ground truth；有注释步骤=不迁移；参数以 grep 实际赋值为准 |
| plan:dependency-existence-check | plan.md | plan 阶段指定实现库(react-hook-form / zod 等) | 对每个库 `grep package.json`;未装的不进 plan 步骤,或前置 Step 加依赖安装 |
| structure:infra-cannot-import-domain | layering.md(补充段) | 写 infra 层时想 import domain 类型 | 错误类型归 `infra/errors.ts`;数据结构用 infra 本地泛型,不反向依赖 domain |
| structure:service-needs-domain-not-container-logic | layering.md(补充段) | 纯函数写在 containers/xxxLogic.ts,后续 service 也要用 | 跨层复用的纯函数归 domain;containers/logic 只留 UI 派生函数 |
| structure:service-cross-feature-orchestration-via-container | layering.md(补充段) | 本 feature Service 想调用另一 feature 的 Service 做跨功能编排 | Service 单一职责不跨 feature;跨 feature 编排在 Container hook 层"mutation of mutations"模式 |
| chain-call:callForPermit-cmdType-to-address-mapping | chain-call-semantics.md | 迁移 CallForPermit 签名调用(claim/unstake/withdraw/deposit) | `to` 目标由 cmdType 决定非固定值;VaultRedeemWithPermit 的 to=SLP 合约,不是 VaultCaller |
| chain-call:token-decimals-dynamic-read | chain-call-semantics.md | 跨多代币(SLP 18 / vMAG7 8)计算 amount/shares/assets 时 | 不同合约的 decimals **必须动态链上读**,不复用单一常量 |
| ui-progress:step-to-event-mapping | ui-progress.md | 带多步 progress UI 的流程(N 次钱包签名/tx 提交) | 每个 step 至少覆盖一个可观察事件;analyze 阶段逐 step 填"覆盖事件"表 |
| ui-progress:modalManager-queue-not-stack | ui-progress.md | 已打开 modal 内再弹另一个 modal(二次确认/嵌套选择器) | modalManager 是队列语义;栈式叠加用 Radix `<Dialog>`,不走 modalManager |
| ui-progress:defer-item-tracking | ui-progress.md | analyze 标 defer 的规则需要跟踪确保后续回补 | `pending.md` + `followUp` 列 + verify 机械检查(已落地 analyze/verify.md) |

---

## 使用

```
/k:migration records list              # 列本索引
/k:migration records load <id>         # 读某条详情
/k:migration records add               # 新增
/k:migration records update <id>       # 更新
/k:migration records remove <id>       # 删除
```

---

## 归属判断（与 pitfall / history 的分工）

| 类型 | 去处 | 判断 |
|---|---|---|
| 本次 feature 具体 bug | `finalize` 写入的 history | 仅本 feature 相关 |
| 跨 migration 方法论 | **records（本目录）** | 下次迁移别的 feature 还会中招 |
| 项目通用写代码坑 | `/k/context-pitfall add` | 平时新写代码也会犯 |
