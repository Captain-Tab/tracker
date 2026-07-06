// IO 横切层（Phase0 底座）：sodex 目标态读取 + hype 价格/meta 读取 + dry-run would-place 构造。
// 纯 REST，无 WS（一期对账走轮询）。范式照搬 sodex-watch/api + HYPE-watch/api（共享限流退避）。
// dry-run 非完全离线：仍连 sodex 读真实仓 + 连 hype 读真实价；只省略「签名 + 提交订单」。
// 纯逻辑（mapping/sizing/reconcile/risk/recommend）只消费本层返回的纯数据，不直接碰网络。
import { installFetchProxy } from "../../lib/WARP/index.mjs";
import { formatPrice, formatSize, applySlippage, mul, div, absStr } from "../process/precision.mjs";

// fetch 走代理（WARP；仅 HTTP_PROXY 存在时生效，无 proxy 时 no-op，import 不发网络）
await installFetchProxy();

// ---------- 环境配置（sodex gateway + hype info/allMids 双端点）----------
export const ENVS = {
  production: {
    sodexGateway: "https://mainnet-gw.sodex.dev", // sodex perps state
    hypeInfo: "https://api.hyperliquid.xyz/info", // hype 只读 info（allMids/meta/clearinghouseState）
  },
};

const SODEX_PERPS_PREFIX = "/api/v1/perps";
const REQUEST_TIMEOUT_MS = 10_000;
export const META_REFRESH_MS = 6 * 60 * 60 * 1_000; // 与 HYPE-watch 一致

const ts = () => new Date().toISOString().slice(11, 19);
export const log = (...a) => console.log(ts(), ...a);

export function parseJsonSafe(text) {
  // sodex 大整数防溢出：16+ 位裸数字包成字符串（照搬 sodex-watch/api parseJsonSafe）
  const guarded = text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(guarded);
}

function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(headerVal);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// ---------- sodex 读：GET（照搬 sodex-watch httpGetJson 范式）----------
export async function httpGetJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? parseJsonSafe(text) : null; } catch { json = { __nonJson: text }; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${url}`);
      err.status = res.status; err.body = json; err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      throw err;
    }
    return json;
  } finally { clearTimeout(timer); }
}

// ---------- hype 读：POST {type,...}（照搬 HYPE-watch infoPost 范式）----------
export async function infoPost(env, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(env.hypeInfo, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? parseJsonSafe(text) : null; } catch { json = { __nonJson: text }; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} info ${body.type}`);
      err.status = res.status; err.body = json; err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      throw err;
    }
    return json;
  } finally { clearTimeout(timer); }
}

// ---------- 两端共享限流退避（照搬 watch/api：秒级翻倍封顶 60s + ±20% jitter）----------
// sodex 端：429/409（sodex-watch 实测 409 亦为限流码）；hype 端：429（按 IP weight）。
export const SODEX_THROTTLE_STATUSES = new Set([429, 409]);
export const HYPE_THROTTLE_STATUSES = new Set([429]);

function makeRateLimiter() {
  let rateLimitUntil = 0;
  let backoff = 0;
  return {
    get until() { return rateLimitUntil; },
    nextBackoffMs() {
      backoff = Math.min((backoff || 1) * 2, 60);
      const base = backoff * 1000;
      return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
    },
    reset() { backoff = 0; },
    enter(waitMs) { rateLimitUntil = Math.max(rateLimitUntil, Date.now() + waitMs); },
  };
}

export const sodexLimiter = makeRateLimiter();
export const hypeLimiter = makeRateLimiter();

// 命中限流统一处理：优先 Retry-After，无则指数退避；推进对应端 limiter。
function handleThrottle(err, limiter, throttleStatuses) {
  if (!throttleStatuses.has(err?.status)) return false;
  const waitMs = err.retryAfterMs ?? limiter.nextBackoffMs();
  limiter.enter(waitMs);
  return true;
}

// ---------- fetchTargetState：读 sodex perps state，归一化（只归一，不映射/不算可映射性）----------
// 字段口径：authoritative api-confidence/sodex.md L89 已证实 P[] 缩写——
//   sz=当前size(带符号张数) / ep=均价 / ms=max_size / cr=已实现 / ur=未实现。
// ✅ 已实测核对（2026-06，真实 sodex P[0] CL-USD）：s=symbol / sz=szi / ep=entryPx / l=leverage(10)
//   全部命中；co=名义敞口（直给）；marginUsed 无直给字段 → 派生 co/leverage（= |sz|×ep/leverage），
//   实测与 co/l 一致（50847.84/10=5084.78）。保留候选键回退以防 wire 变更。
function pickField(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function normalizeTargetPositions(rawPositions) {
  if (!Array.isArray(rawPositions)) return [];
  return rawPositions.map((p) => {
    const symbol = String(pickField(p, ["s", "symbol", "sym"]) ?? "?");
    const szi = String(pickField(p, ["sz", "szi", "size"]) ?? "0");
    const entryPx = pickField(p, ["ep", "entryPx", "avgEntryPrice"]);
    const leverage = Number(pickField(p, ["l", "leverage", "lev"]) ?? 0);
    // marginUsed 优先显式字段；缺失则派生（leverage>0）：优先 co/leverage（co=名义敞口，
    // 交易所直给、最精确），退而 |sz|×ep/leverage。均走 precision 避免裸浮点（§3.3）。
    let marginUsed = pickField(p, ["mu", "marginUsed", "im", "initialMargin"]);
    if ((marginUsed === undefined || marginUsed === null) && leverage > 0) {
      const co = pickField(p, ["co"]); // sodex 名义敞口（实测字段）
      if (co !== undefined) marginUsed = div(String(co), String(leverage));
      else if (entryPx) marginUsed = div(mul(absStr(szi), String(entryPx)), String(leverage));
    }
    return {
      symbol,
      szi,
      marginUsed: marginUsed !== undefined && marginUsed !== null ? String(marginUsed) : "0",
      leverage,
      cr: String(pickField(p, ["cr", "cumRealized"]) ?? "0"), // 累计已实现盈亏
      cf: String(pickField(p, ["cf", "cumFee", "cumFunding"]) ?? "0"), // 累计资金费率
      lp: String(pickField(p, ["lp", "liquidationPx"]) ?? "0"), // 目标强平价（生存杠杆锚定，07-budget-alloc §3.1）；"0"=无强平风险
      ...(entryPx !== undefined ? { entryPx: String(entryPx) } : {}),
    };
  });
}

export async function fetchTargetState(env, sodexAddr) {
  const url = `${env.sodexGateway}${SODEX_PERPS_PREFIX}/accounts/${sodexAddr}/state`;
  try {
    const json = await httpGetJson(url);
    sodexLimiter.reset();
    const data = json?.data ?? json ?? {};
    const rawPositions = data.P ?? data.positions ?? [];
    return normalizeTargetPositions(rawPositions);
  } catch (err) {
    handleThrottle(err, sodexLimiter, SODEX_THROTTLE_STATUSES);
    throw err;
  }
}

// ---------- fetchHypePrices：allMids 原样 coin→midPx 字符串（不换算/不舍入）----------
// xyz index perps 有独立 allMids，需并行查询并合并
export async function fetchHypePrices(env) {
  try {
    const [midsNative, midsXyz] = await Promise.all([
      infoPost(env, { type: "allMids" }),
      infoPost(env, { type: "allMids", dex: "xyz" }),
    ]);
    hypeLimiter.reset();
    const out = {};
    for (const [coin, px] of Object.entries(midsNative ?? {})) out[coin] = String(px);
    for (const [coin, px] of Object.entries(midsXyz ?? {})) out[coin] = String(px);
    return out;
  } catch (err) {
    handleThrottle(err, hypeLimiter, HYPE_THROTTLE_STATUSES);
    throw err;
  }
}

// ---------- buildHypeAssetIndex：meta.universe 下标 → coin→{index, szDecimals}（下单参数必需）----------
let assetIndexCache = new Map();
let assetIndexCachedAt = 0;

export function parseHypeMeta(metaJson) {
  const universe = Array.isArray(metaJson?.universe) ? metaJson.universe : [];
  const map = new Map();
  universe.forEach((u, index) => {
    // maxLeverage 供 mm=1/(2×maxLeverage) + openLeverage 上限（07-budget-alloc §3.1）
    map.set(String(u.name), { index, szDecimals: Number(u.szDecimals), maxLeverage: Number(u.maxLeverage) });
  });
  return map;
}

export async function buildHypeAssetIndex(env, { force = false } = {}) {
  const fresh = assetIndexCache.size > 0 && Date.now() - assetIndexCachedAt < META_REFRESH_MS;
  if (fresh && !force) return assetIndexCache;
  try {
    // xyz index perps 有独立 meta universe，需并行查询并合并（native + xyz 无 coin 名冲突）
    const [metaNative, metaXyz] = await Promise.all([
      infoPost(env, { type: "meta" }),
      infoPost(env, { type: "meta", dex: "xyz" }),
    ]);
    hypeLimiter.reset();
    const map = parseHypeMeta(metaNative);
    const xyzMap = parseHypeMeta(metaXyz);
    for (const [coin, entry] of xyzMap) map.set(coin, entry);
    if (map.size) { assetIndexCache = map; assetIndexCachedAt = Date.now(); log(`asset index 缓存已更新：${map.size} 个 perps (native + xyz)`); }
    else log("meta universe 为空，沿用旧缓存");
    return assetIndexCache;
  } catch (err) {
    handleThrottle(err, hypeLimiter, HYPE_THROTTLE_STATUSES);
    throw err;
  }
}

// ---------- placeDryRun：构造 would-place 订单参数（不签名不提交；真实提交占位 throw）----------
// 对齐 blueprint §8.3 order action 形状；p/s 走 precision.mjs ROUND_DOWN（禁裸 parseFloat / tool/format）。
export function placeDryRun(leg, { assetIndex, szDecimals, slippageBps, dryRun }) {
  if (dryRun !== true) {
    // 真实下单口子集中占位：后续阶段在此接 EIP-712 phantom agent 签名 + ExchangeClient.order。
    throw new Error("real submit 留待后续阶段（一期仅 dry-run，不签名不提交）");
  }
  const limitPx = applySlippage(leg.refPx, slippageBps, leg.isBuy, szDecimals);
  const size = formatSize(leg.size, szDecimals);
  return {
    ts: Date.now(),
    action: "would-place",
    coin: leg.coin,
    order: {
      a: assetIndex,
      b: leg.isBuy,
      p: limitPx,
      s: size,
      r: leg.reduceOnly === true,
      t: { limit: { tif: "Ioc" } },
    },
    dryRun: true,
  };
}

// ---------- getMyLiqPrice：我方强平价注入抽象（07-budget-alloc §3.6）----------
// dry-run：委托注入的 estimate()（= computeMyLiqPrice，Phase B 提供，读 myMarginByCoin 模拟保证金）。
// 实盘：读 clearinghouseState.assetPositions[].position.liquidationPx —— 留实盘阶段，本期 throw 占位。
// 决策逻辑（planDefend）两阶段共用，只切换本函数的数据源。
export function getMyLiqPrice({ dryRun = true, estimate } = {}) {
  if (dryRun) {
    if (typeof estimate !== "function") throw new Error("dry-run getMyLiqPrice 需注入 estimate()（computeMyLiqPrice）");
    return estimate();
  }
  throw new Error("getMyLiqPrice 实盘分支留实盘阶段（读 clearinghouseState.liquidationPx）");
}

// ---------- buildWouldUpdateLeverage：dry-run 构造 updateLeverage 动作（不签名）----------
// 对齐 SDK updateLeverage：{asset, isCross, leverage(整数≥1)}。逐仓恒 isCross=false。
export function buildWouldUpdateLeverage({ assetIndex, leverage, dryRun }) {
  if (dryRun !== true) throw new Error("real submit 留待后续阶段（一期仅 dry-run，不签名不提交）");
  return {
    ts: Date.now(),
    action: "would-update-leverage",
    order: { asset: assetIndex, isCross: false, leverage: Math.max(1, Math.trunc(Number(leverage))) },
    dryRun: true,
  };
}

// ---------- buildWouldUpdateMargin：dry-run 构造 updateIsolatedMargin 动作（不签名）----------
// 对齐 SDK updateIsolatedMargin：{asset, isBuy(仓位方向 多true/空false), ntli(金额×1e6 整数, 正=加/负=减)}。size 不变。
export function buildWouldUpdateMargin({ assetIndex, isBuy, amountUsd, dryRun }) {
  if (dryRun !== true) throw new Error("real submit 留待后续阶段（一期仅 dry-run，不签名不提交）");
  return {
    ts: Date.now(),
    action: "would-update-margin",
    order: { asset: assetIndex, isBuy: isBuy === true, ntli: Math.round(Number(amountUsd) * 1e6) },
    dryRun: true,
  };
}

export { formatPrice };
