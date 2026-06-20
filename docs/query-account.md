# 通过钱包地址查询仓位与委托

`service/watch/query.mjs` 的配套文档：解释它调用的接口、参数与执行流程，并附本地 `watch` 模式查看方式。

## 一、目标

输入一个钱包 `address`，输出该账户的：

- **仓位 Positions**（合约持仓）
- **当前委托 Open Orders**（现货 + 合约挂单）

数据来自两套后端，互为主备：

| | 主路 | 备路 |
| --- | --- | --- |
| 项目 | sodex-next（新） | sodex-web（旧） |
| 入参 | `address`（直接查） | `accountId`（需先解析） |
| 触发 | 默认开启 | **默认关闭**，需 `--enable-web-fallback` 开启；开启后主路抛错降级，或 `--source=web` 强制 |

> sodex-web 备用/兜底默认关闭。不传 `--enable-web-fallback` 时，只走 sodex-next 主路，主路失败即报错退出，不会降级到 web。

## 二、接口与参数

所有接口共用生产网关 `https://mainnet-gw.sodex.dev`；`address → accountId` 解析走 chain 服务 `https://sodex.dev/mainnet`。

### 主路 sodex-next（入参 = address）

| 用途 | Method + Path | 参数 |
| --- | --- | --- |
| 合约快照（含仓位 + 合约委托） | `GET /api/v1/perps/accounts/{address}/state` | `accountID`（可选，省略即查该地址首个账户） |
| 现货快照（含现货委托 + 余额） | `GET /api/v1/spot/accounts/{address}/state` | `accountID`（可选） |

> 也有更细的 `GET /api/v1/perps/accounts/{address}/positions` 与 `.../orders`，本脚本用一次性 `/state` 端点同时取仓位与委托。
> path 前缀 `/api/v1/perps`、`/api/v1/spot` 由 `@sodex/sdk` 内部拼接（`PerpsClient` / `SpotClient`）。

返回快照里提取：`positions`（仓位）、`openOrders`（委托）。

### 备路 sodex-web（入参 = accountId）

| 用途 | Method + Path | 参数 |
| --- | --- | --- |
| 仓位（合约账户详情，含 positions） | `GET /futures/fapi/user/v1/public/account/details` | `accountId` |
| 合约委托 | `GET /futures/fapi/trade/v1/public/list` | `accountId` |
| 现货委托 | `GET /pro/p/user/order/list` | `accountId` |

> path 含 `public`，无需鉴权 header，仅凭 `accountId` 即可读取。

### address → accountId 解析（仅备路需要，主备双源）

| | Method + Path / 来源 | 返回 |
| --- | --- | --- |
| 主（HTTP，零依赖） | `GET {chain}/chain/address/{address}/accounts` | `data.primaryAccountId` |
| 备（链上合约，可选） | `CLOB_GATEWAY.getAccountsByAddress(address)` → `uint256[]`，取 `[0]` | 默认未启用 |

链上备路常量（启用时需 viem）：合约 `0x0101010101010101010101010101010101010101`，RPC `https://mainnet.valuechain.xyz/`，chainId `286623`。

## 三、执行流程

```
node service/watch/query.mjs 0xAddress
        │
        ├─【主】queryNext(address)
        │     并发 GET /api/v1/perps/accounts/{address}/state
        │           GET /api/v1/spot/accounts/{address}/state
        │     → { positions[], openOrders[](perps+spot) }
        │     成功 → 输出，结束
        │     失败 → 若未开启 --enable-web-fallback，直接报错退出
        │
        └─【备】仅当 --enable-web-fallback 开启（主路抛错降级 或 --source=web）
              ① resolveAccountId(address)
                   HTTP chain api（主）→ 链上合约（备，默认关）
              ② queryWeb(accountId)
                   并发打 web 三接口
              → 归一成同样的 { positions[], openOrders[] }
```

委托项统一带 `market: "perps" | "spot"` 标记，调用方无需关心数据来自哪一套。

## 四、脚本用法

```bash
node service/watch/query.mjs 0xYourAddress                                  # 生产环境，仅 next 主路
node service/watch/query.mjs 0xYourAddress --raw                            # 附原始响应（首次跑用它校准字段名）
node service/watch/query.mjs 0xYourAddress --enable-web-fallback            # next 主路 + web 兜底
node service/watch/query.mjs 0xYourAddress --enable-web-fallback --source=web  # 强制只走 sodex-web 备路
node service/watch/query.mjs 0xYourAddress --env=preview                    # 切 preview 环境
```

| flag | 说明 |
| --- | --- |
| `--env=production\|preview` | 选择网关与 chain 服务地址，默认 `production` |
| `--raw` | 额外打印每个接口的原始 JSON |
| `--enable-web-fallback` | 开启 sodex-web 备用/兜底逻辑（**默认关闭**，关闭时主路失败直接退出，不降级） |
| `--source=next\|web` | 强制只走某一路（`web` 需配合 `--enable-web-fallback`） |

> wire 字段已实测为单字母缩写：`data.P`=仓位、`data.O`=委托、`data.B`=余额、`data.user/aid/uid`=账户标识。脚本已按此提取并保留全名 fallback。需要看每个订单/仓位项的完整字段时加 `--raw`。

## 五、在本地页面用 watch 模式查看

除了脚本，本地 dev server 也能直接“以只读身份观察任意地址”，看到完整的仓位/委托 UI。

- **生效条件**：仅 `import.meta.env.MODE !== "production"`（即 `pnpm dev`，生产构建禁用）。源码 `src/features/auth/containers/useWatchMode.ts:16,30`。
- **参数**：`?watch=0x有效地址`（必须是合法 EVM 地址，否则视为退出 watch）；可选 `?admin=1` 附带缓存 JWT。
- **路由**：仓位是合约数据 → 用合约页 `/trade/futures/:symbolId`。

完整本地 URL（在你已打开的某个合约交易页 URL 后追加 `?watch=`）：

```
http://localhost:3000/trade/futures/<symbolId>?watch=0x要观察的地址
```

退出 watch：把 `watch` 去掉，或 `?watch=0`。

进入后底部「仓位 / 当前委托」会展示被观察地址的数据（钱包会被强制断开，纯只读）。
