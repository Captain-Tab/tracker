#!/usr/bin/env node
// 通过钱包 address 查询某账户的「仓位」和「当前委托」。
// 主路 sodex-next（直接用 address），失败降级到备路 sodex-web（需先解析 accountId）。
//
// 用法：
//   node script/query-account.mjs 0xYourAddress
//   node script/query-account.mjs 0xYourAddress --env=preview   # 默认 production
//   node script/query-account.mjs 0xYourAddress --raw           # 打印原始响应
//   node script/query-account.mjs 0xYourAddress --enable-web-fallback        # 开启 sodex-web 备用/兜底
//   node script/query-account.mjs 0xYourAddress --enable-web-fallback --source=web  # 强制只走备路
//
// 默认只走 sodex-next 主路；sodex-web 备用/兜底默认关闭，需 --enable-web-fallback 才启用。
// 零依赖：Node 18+ 内置 fetch。链上解析 accountId 为可选增强（见 resolveAccountIdViaChain 注释）。

// 环境配置（取自项目 .env.production / .env.preview）
const ENVS = {
  production: {
    gateway: "https://mainnet-gw.sodex.dev", // sodex-next + sodex-web 共用网关
    chain: "https://sodex.dev/mainnet", // address -> accountId 的备用 HTTP api
  },
  preview: {
    gateway: "https://mainnet-gw.sodex.dev",
    chain: "https://sodex.dev/mainnet",
  },
};

// sodex-next（@sodex/sdk）真实 path 前缀
const NEXT_PERPS_PREFIX = "/api/v1/perps";
const NEXT_SPOT_PREFIX = "/api/v1/spot";

// sodex-web 旧接口 path（入参 accountId）
const WEB_PERPS_ACCOUNT_DETAILS = "/futures/fapi/user/v1/public/account/details";
const WEB_PERPS_ORDER_LIST = "/futures/fapi/trade/v1/public/list";
const WEB_SPOT_ORDER_LIST = "/pro/p/user/order/list";

const REQUEST_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      flags[key] = value === undefined ? true : value;
    } else {
      positional.push(arg);
    }
  }
  return { address: positional[0], flags };
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

async function httpGetJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { __nonJson: text };
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${url}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 主路：sodex-next（address 直查）----------

async function queryNext(gateway, address) {
  const [perpsState, spotState] = await Promise.all([
    httpGetJson(`${gateway}${NEXT_PERPS_PREFIX}/accounts/${address}/state`),
    httpGetJson(`${gateway}${NEXT_SPOT_PREFIX}/accounts/${address}/state`),
  ]);

  // wire 顶层为缩写字段：P=positions, O=open orders, B=balances（已实测）。
  // 保留全名 fallback 以兼容潜在的响应格式变化；原始数据用 --raw 查看。
  const perps = perpsState?.data ?? perpsState ?? {};
  const spot = spotState?.data ?? spotState ?? {};

  const positions = perps.P ?? perps.positions ?? [];
  const perpsOrders = perps.O ?? perps.openOrders ?? [];
  const spotOrders = spot.O ?? spot.openOrders ?? [];

  return {
    source: "sodex-next",
    address,
    positions,
    openOrders: [
      ...perpsOrders.map((o) => ({ market: "perps", ...o })),
      ...spotOrders.map((o) => ({ market: "spot", ...o })),
    ],
    raw: { perpsState, spotState },
  };
}

// ---------- address -> accountId（备路前置，主 HTTP api + 备链上）----------

// 主：HTTP chain api（零依赖）
async function resolveAccountIdViaApi(chainBase, address) {
  const resp = await httpGetJson(`${chainBase}/chain/address/${address}/accounts`);
  if (resp?.code !== 0 || !resp?.data) return null;
  return resp.data.primaryAccountId || null;
}

// 备：链上合约 getAccountsByAddress（需要 viem，可选）。
// 默认不启用——如需启用，安装/复用 viem 后取消注释并在 resolveAccountId 里接上。
//   import { createPublicClient, http, encodeFunctionData } from "viem";
//   合约 0x0101...0101，selector getAccountsByAddress(address) -> uint256[]
//   ValueChain RPC: https://mainnet.valuechain.xyz/  chainId 286623
async function resolveAccountIdViaChain(_address) {
  return null; // 占位：默认走 HTTP api，链上作为可选增强
}

async function resolveAccountId(chainBase, address) {
  const viaApi = await resolveAccountIdViaApi(chainBase, address).catch(() => null);
  if (viaApi) return viaApi;
  const viaChain = await resolveAccountIdViaChain(address).catch(() => null);
  return viaChain;
}

// ---------- 备路：sodex-web（accountId 查）----------

async function queryWeb(gateway, address, accountId) {
  const q = `accountId=${encodeURIComponent(accountId)}`;
  const [details, perpsOrders, spotOrders] = await Promise.all([
    httpGetJson(`${gateway}${WEB_PERPS_ACCOUNT_DETAILS}?${q}`),
    httpGetJson(`${gateway}${WEB_PERPS_ORDER_LIST}?${q}`),
    httpGetJson(`${gateway}${WEB_SPOT_ORDER_LIST}?${q}`),
  ]);

  const detailData = details?.data ?? details ?? {};
  const positions = detailData.positions ?? [];
  const perpsList = perpsOrders?.data ?? perpsOrders ?? [];
  const spotList = spotOrders?.data ?? spotOrders ?? [];

  return {
    source: "sodex-web",
    address,
    accountId,
    positions,
    openOrders: [
      ...(Array.isArray(perpsList) ? perpsList : []).map((o) => ({ market: "perps", ...o })),
      ...(Array.isArray(spotList) ? spotList : []).map((o) => ({ market: "spot", ...o })),
    ],
    raw: { details, perpsOrders, spotOrders },
  };
}

// ---------- 编排 ----------

async function main() {
  const { address, flags } = parseArgs(process.argv.slice(2));

  if (!isAddress(address)) {
    console.error("用法: node script/query-account.mjs 0xAddress [--env=production|preview] [--raw] [--enable-web-fallback] [--source=next|web]");
    process.exit(1);
  }

  const env = ENVS[flags.env ?? "production"];
  if (!env) {
    console.error(`未知 env: ${flags.env}（可选 production / preview）`);
    process.exit(1);
  }

  const enableWebFallback =
    flags["enable-web-fallback"] === true || flags["enable-web-fallback"] === "true";
  const forceSource = flags.source; // "next" | "web" | undefined

  // 强制走 web 必须先开启备用开关
  if (forceSource === "web" && !enableWebFallback) {
    console.error("--source=web 需要同时传 --enable-web-fallback（sodex-web 备用默认关闭）");
    process.exit(1);
  }

  let result = null;

  // 主路 next（除非强制 web）
  if (forceSource !== "web") {
    try {
      result = await queryNext(env.gateway, address);
    } catch (err) {
      console.error(`[next 主路失败] ${err.message}`);
      // 备用关闭时不降级，直接失败
      if (!enableWebFallback || forceSource === "next") process.exit(2);
    }
  }

  // 备路 web：仅在开启备用开关时启用（next 失败降级，或强制 web）
  if (enableWebFallback && (!result || forceSource === "web")) {
    const accountId = await resolveAccountId(env.chain, address);
    if (!accountId) {
      console.error("[备路失败] 无法解析 accountId（HTTP chain api 未返回，链上备路默认未启用）");
      process.exit(3);
    }
    result = await queryWeb(env.gateway, address, accountId);
  }

  if (!result) {
    console.error("查询失败：主路无数据，且 sodex-web 备用未开启（加 --enable-web-fallback 兜底）");
    process.exit(2);
  }

  // 输出
  const summary = {
    source: result.source,
    address: result.address,
    accountId: result.accountId,
    positionCount: result.positions.length,
    openOrderCount: result.openOrders.length,
  };
  console.log("=== 摘要 ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\n=== 仓位 Positions ===");
  console.log(JSON.stringify(result.positions, null, 2));
  console.log("\n=== 当前委托 Open Orders ===");
  console.log(JSON.stringify(result.openOrders, null, 2));

  if (flags.raw) {
    console.log("\n=== 原始响应 raw ===");
    console.log(JSON.stringify(result.raw, null, 2));
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
