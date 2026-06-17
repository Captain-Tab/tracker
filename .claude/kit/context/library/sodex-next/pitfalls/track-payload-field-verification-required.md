---
id: track-payload-field-verification-required
tags: [tracking, payload, sosovalue, data-contract, verification, storage-writer, global-track]
related_feature: global-track
severity: high
gate: true
gate_rule: 埋点 / 数据契约项目中，新增字段或迁移 sodex-web 字段时，必须解码实际 POST payload 逐字段对照 spec 期望值，不能仅以"代码链路触发"作为验证证据；尤其依赖 localStorage / cookie / store 读取的字段，必须显式确认"写入源"在 sodex-next 是否存在
trigger: [tracking, 埋点, payload, sosovalue, propertyPlugin, sensors, datasink, saTrack, 神策, sa?project, walletAddress, walletType, sodex-web 迁移]
date: 2026-05-12
---

# 埋点 payload 字段值未被实际验证：walletAddress / walletType 长期为空

## 问题描述

Batch A 基础设施迁移完成、tsc / eslint / 浏览器 Network 200 OK / 代码审查全部通过、 Context Library 已记录后，用户主动解码一条 preview 部署的 `datasink.sosovalue.com/sa?project=default` POST 请求 base64 payload，发现：

```jsonc
{
  "distinct_id": "a7vqGOTt/O6wX7bhORDgrPbaYlKODIXieNty4TKpnQROqlyuA4LcAD2+DAPV8YWN",
  //              ↑ AES 加密钱包地址（解密为 0xf936...）→ ✅ 神策侧身份关联正确
  "properties": {
    "sosovalue": "{\"walletAddress\":\"\",\"walletType\":\"\",\"userId\":\"\",...}"
    //                              ↑ 空字符串！                ↑ 空        ↑ 空
  }
}
```

distinct_id（神策标准字段）正确，但 sosovalue 嵌套对象内**所有依赖 localStorage 的明文身份字段**（`walletAddress` / `walletType` / `userId`）**长期为空**。同一用户在另一浏览器实测则可能显示残留的 sodex-web 旧地址 `0xF23C...`（与当前实际连接的 `0x1d3F...` 不符），即"数据脏"。

## 调试过程中的误判

**误判 1（Spec 阶段）**：读 sodex-web 代码看到 `getWalletAddress()` reader，自动假设"localStorage `__wallet_address__` 有人会写"。**没 grep `setWalletAddress(`** 看实际调用源（sodex-web 在 `contexts/login/index.tsx:412` 的 LoginProvider 写）。

**误判 2（Plan 阶段）**：信息缺口自审列了 3 项（deviceId key / AES secret / CSP 域名），就地关闭。**遗漏了"`__wallet_address__` 写入源在 sodex-next 是否存在"这一项**。如果列入并 grep 一次，1 分钟内能发现 sodex-next 完全没有调用源（auth feature 重构为 zustand session，不再写 localStorage）。

**误判 3（Task 阶段）**：实现 `getWalletAddress` reader 时**没注意到没有对称的 writer**。getter/setter 不配对出现是隐性 bug 信号。

**误判 4（Debug 阶段）**：H2:P1 propertyPlugin 入口插桩 log 了 `event` / `url` / `urlPath` / `element_type` / `element_content` / `event_duration` / `viewport_position` —— **没 log `sosovalue.walletAddress`**。聚焦"事件触发了吗"，忽略了"字段值对吗"。如果当时 log 了，立刻能看到空字符串问题。

**误判 5（Check 阶段）**：CHK-01「功能需求 MUST 全部满足」用「propertyPlugin 注入 + buildSosovalueParams 构造」作证据 → 引述代码描述，**没去解一条真实 base64 payload 看字段值**。典型「AI 自审循环」：AI 写 spec → AI 写代码 → AI 写 check 对照表 → AI 说"通过"，无外部 ground truth。

## 根因

**整个流程在用"代码视角"验证"数据契约"项目**。

| 视角 | 验证手段 | 本批次实际做了 |
|---|---|---|
| 代码视角 | tsc 通过 / build 通过 / 调用栈对 / hook 触发 | ✅ 全做了 |
| 数据视角 | 解码 payload / 字段值匹配期望 / 数仓 schema 一致 | ❌ 完全没做 |

埋点 / 协议 / API 契约 这类项目，**核心是「数据是 Y」，不是「代码做了 X」**。用错验证方式 → bug 逃出所有 gate。

数据写入链路的具体断点：

```
sodex-web (历史)：
  钱包连接 → LoginProvider:cacheWalletInfoToLocal
           → local.setWalletAddress(address) ← 业务逻辑写 localStorage
           → trackConnectWallet ← 埋点搭便车读 localStorage

sodex-next (迁移后)：
  钱包连接 → wagmi useAccount + zustand useAuthStore
           → session.address ← 派生消费，不再写 localStorage
           → trackConnectWallet（只调 sensors.identify） ← 埋点 reader 读到空
           → propertyPlugin 注入空字符串
```

**业务侧和埋点侧的耦合被重构断了，spec / plan / task / check / debug 全部没注意到**。

## 避免方式

### 触发场景

- 新接入 Batch B / C / D 业务事件时
- 任何 sosovalue 字段 / GA user_id / API 契约字段的增删改时
- 从 sodex-web 迁移涉及 localStorage / cookie / store 数据的代码时

### 必做检查（按阶段）

| 阶段 | 必做 | 命令 / 动作 |
|---|---|---|
| **Spec** | 字段依赖追溯 | 对每个新字段问：「值的写入源是什么？是 localStorage / store / props / 业务上下文？」grep sodex-web 找调用源 |
| **Plan** | 信息缺口包含字段写入源 | 把「字段 X 的 writer 在 sodex-next 是否存在」明确列入 §4.C 信息缺口；执行 `grep -rn 'setXxx(' src/` 当场关闭 |
| **Task** | getter/setter 对称检查 | 实现 reader 时，确认对应的 writer 存在；如不存在，在 service 层补 set 调用 |
| **Debug** | propertyPlugin / payload 入口必须 log 字段值 | 插桩 H2 propertyPlugin 时 log `sosovalue.walletAddress` / `sosovalue.userId` 等关键字段实际值，不仅 log event name |
| **Check** | CHK-01 验收必须含解码命令 | 不接受「代码已实现」作证据；必须 `curl ... \| jq` 或解 base64 看字段值，对照 spec 期望 |

### 一条通用命令模板

```bash
# 从 Network 抓 base64 payload 后，Console 跑：
JSON.parse(decodeURIComponent(escape(atob("<base64>"))))
  → .properties.sosovalue            // 是字符串，需再 JSON.parse 一次
  → 看 walletAddress / walletType / userId 是否符合期望

# 期望矩阵：
#   未连钱包  → walletAddress = ""
#   连钱包 A → walletAddress = "0xA"（明文，wagmi 原 case）
#   切到 B   → walletAddress = "0xB"（覆盖）
#   登出     → walletAddress = ""（清除）
```

### Anti-pattern（避免）

- ❌ "tsc 通过 = 实现完成"（埋点项目不适用）
- ❌ "Network 200 OK = 数据正确"（HTTP 成功 ≠ payload 内容对）
- ❌ "代码读 localStorage 就行，肯定有人写"（必须 grep 写入源）
- ❌ "AI 自己写 spec → AI 自己说 check 通过"（必须外部 ground truth）
