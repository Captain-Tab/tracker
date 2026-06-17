# Wagmi 分层规则（sodex-next 参考）

> 来源：sodex-next/docs/wagmi.md
> 用途：migration execute 阶段，迁移涉及钱包签名功能时参考

## 分层原则

Wagmi 整体归属 Infra Layer，按读写性质区分。

### Read Hooks（Container 可直接使用）

只读状态订阅，无副作用，不弹签名弹窗：
- `useAccount()` — 当前连接地址、连接状态
- `useChainId()` — 当前链 ID
- `useBalance()` — 链上原生代币余额
- `useReadContract()` — 链上合约只读调用
- `useBlockNumber()` — 当前区块号
- `useConnectors()` — 可用连接器列表

### Write Actions（必须封装在 Infra）

使用 `wagmi/actions` 的纯函数版本（非 React Hook），在 Infra 层调用：
- `signTypedData()` — EIP-712 结构化签名（核心）
- `signMessage()` — 签名任意消息

```ts
// infra/rpc/walletSignInfra.ts
import { signMessage, signTypedData } from "wagmi/actions"
import { wagmiConfig } from "@/lib/walletConfig"

export async function signLoginMessage(message: string): Promise<string> {
  try {
    return await signMessage(wagmiConfig, { message })
  } catch (error) {
    throw mapWalletError(error)
  }
}
```

> 为什么不用 Hook 版本？Hook 需要从 Container 穿透到 Service 再到 Infra（3 层回调穿透）。纯函数版本 Infra 自给自足，调用链更短。

## EIP-712 签名安全规范

| 字段 | 来源 | 说明 |
|---|---|---|
| chainId | useChainId() / wagmi config | 防止跨链重放 |
| verifyingContract | 后端配置 / marketConfig | EIP-712 domain 合约地址 |
| nonce | 后端分配 | 防止同链重放 |
| deadline / expiration | 客户端生成（当前时间 + TTL） | 签名过期保护（推荐 120s） |

安全规则：
- 签名前校验 chainId 与当前连接链一致
- nonce 由后端 API 决定，客户端不自行维护
- 时钟偏差：使用服务器 serverTime 校准，容忍 ±5s
- 签名失败只有两种 InfraError：SIGNATURE_REJECTED / SIGNATURE_TIMEOUT

## 判断规则

会弹钱包弹窗 / 产生链上副作用？
- **不会** → Read Hook → Container 可直接用
- **会** → Write Action → 必须封装在 Infra
