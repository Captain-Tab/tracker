// IO 层（接口收口）：REST 请求 + 共享限流 + Telegram + 符号缓存 + 平仓历史 + accountId 解析。
// 纯 REST，不含 WS（WS polyfill 在 process/watcher.mjs，避免 query 被迫依赖 ws）。
// 共享可变状态（sharedRateLimitUntil / watcherRegistry / 符号缓存）经 ES module live binding 供 watcher 读写。
import { baseCoin, toPositionHistoryRecords } from "../process/parse.mjs";
import { installFetchProxy } from "../../lib/WARP/index.mjs";

// fetch 走代理（WARP，统一封装在 lib/WARP；仅 HTTP_PROXY 存在时生效）
await installFetchProxy();

// ---------- 环境配置 ----------
export const ENVS = {
  production: {
    gatewayWs: "wss://mainnet-gw.sodex.dev",
    gateway: "https://mainnet-gw.sodex.dev",
    data: "https://mainnet-data.sodex.dev",
    biz: "https://alpha-biz.sodex.dev",
    bizEnv: "mainnet",
    chain: "https://sodex.dev/mainnet",
  },
};

// 429/409 同属限流家族（409 为本网关实测限流码，非标准 Conflict 语义）
export const THROTTLE_STATUSES = new Set([429, 409]);

const REQUEST_TIMEOUT_MS = 10_000;
export const SYMBOLS_REFRESH_MS = 6 * 60 * 60 * 1_000;
const TG_TIMEOUT_MS = 8_000;
export const SEEN_IDS_CAP = 2000; // seenPositionIds 上限，超出用当前数据重建防长跑泄漏

// ---------- 日志 ----------
const ts = () => new Date().toISOString().slice(11, 19);
export const log = (...a) => console.log(ts(), ...a);

// ---------- JSON / Retry-After 解析 ----------
export function parseJsonSafe(text) {
  const guarded = text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(guarded);
}

// Retry-After 解析：纯秒数 或 HTTP-date；无法解析返回 null（由调用方回退指数退避）
function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(headerVal);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

export async function httpGetJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? parseJsonSafe(text) : null; } catch { json = { __nonJson: text }; }
    if (!res.ok) { const err = new Error(`HTTP ${res.status} ${url}`); err.status = res.status; err.body = json; err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after")); throw err; }
    return json;
  } finally { clearTimeout(timer); }
}

// ---------- 模块级共享限流（多地址聚合 QPS 受控，一处 429/409 全员退避）----------
export let sharedRateLimitUntil = 0;
export let sharedBackoff = 0;
let sharedWakeScheduled = false;
export const watcherRegistry = new Set();

// 限流退避（秒级翻倍封顶 60s）+ ±20% jitter，防多实例同步重试惊群
export function nextSharedBackoffMs() {
  sharedBackoff = Math.min((sharedBackoff || 1) * 2, 60);
  const base = sharedBackoff * 1000;
  return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
}

// 拉取成功后由调用方调用，清零退避计数
export function resetSharedBackoff() {
  sharedBackoff = 0;
}

// 冷却结束唤醒全部 watcher（G2）：冷却期内其他 watcher 的 stateFp 已推进但 scheduleFetch 被
// gate 丢弃；若只唤醒命中 429 的实例，其余永不重触发→漏报。故冷却结束遍历全员各触发一次
// scheduleFetch（各自 outFp 去重，无变化不重复上报）。cooldown 被后续 429 延长时自动重排。
function scheduleSharedWake() {
  if (sharedWakeScheduled) return;
  sharedWakeScheduled = true;
  const tick = () => {
    const remain = sharedRateLimitUntil - Date.now();
    if (remain > 0) { setTimeout(tick, remain + 500); return; }
    sharedWakeScheduled = false;
    for (const w of watcherRegistry) w.scheduleFetch();
  };
  setTimeout(tick, Math.max(0, sharedRateLimitUntil - Date.now()) + 500);
}

export function enterSharedRateLimit(waitMs) {
  sharedRateLimitUntil = Math.max(sharedRateLimitUntil, Date.now() + waitMs);
  scheduleSharedWake();
}

// ---------- Telegram 推送 ----------
export async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e) { log(`TG 推送失败：${e.message}`); }
}

// ---------- 符号元数据缓存（id / symbol 双索引；含精度，用于按币种格式化）----------
let symbolsById = new Map();
let symbolsBySymbol = new Map();

const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function buildSymbolMeta(s) {
  return {
    name: `${s.baseCoin}/${s.quoteCoin}`,
    baseCoin: s.baseCoin,
    quoteCoin: s.quoteCoin,
    pricePrecision: numOr(s.pricePrecision, 4),       // 价格小数位（按币种）
    quantityPrecision: numOr(s.quantityPrecision, 6), // 数量小数位
    feePrecision: numOr(s.quoteCoinDisplayPrecision, 4), // 手续费（quote 币）展示位
  };
}

export async function refreshSymbols(env) {
  const json = await httpGetJson(`${env.biz}/biz/futures/symbols?env=${env.bizEnv}`);
  const list = Array.isArray(json?.data) ? json.data : [];
  const byId = new Map();
  const bySym = new Map();
  for (const s of list) { const m = buildSymbolMeta(s); byId.set(Number(s.id), m); bySym.set(String(s.symbol), m); }
  if (byId.size) { symbolsById = byId; symbolsBySymbol = bySym; log(`符号缓存已更新：${byId.size} 个 perps 交易对`); }
  else log("符号列表为空，沿用旧缓存");
}

const DEFAULT_META = { name: "?", baseCoin: "", quoteCoin: "", pricePrecision: 4, quantityPrecision: 6, feePrecision: 4 };

export function symbolMeta(symbolId) {
  return symbolsById.get(Number(symbolId)) ?? { ...DEFAULT_META, name: `#${symbolId}` };
}

export function symbolMetaBySymbol(symbol) {
  return symbolsBySymbol.get(String(symbol)) ?? { ...DEFAULT_META, name: baseCoin(symbol), quoteCoin: "USDC" };
}

// ---------- accountId 解析 ----------
export async function resolveAccountIdViaChain(env, address) {
  const resp = await httpGetJson(`${env.chain}/chain/address/${address}/accounts`).catch(() => null);
  if (resp?.code !== 0 || !resp?.data) return null;
  return resp.data.primaryAccountId ?? null;
}

// ---------- 当前持仓（account state REST，替代 WS 断连时的数据源）----------
export async function fetchAccountState(env, address) {
  const json = await httpGetJson(`${env.gateway}/api/v1/perps/accounts/${address}/state`);
  return { positions: parseAccountStatePositions(json?.data), raw: json };
}

// 解析 account state 响应中的 P 数组（当前持仓），字段与 WS accountState 一致
export function parseAccountStatePositions(data) {
  const positions = data?.P ?? [];
  if (!Array.isArray(positions)) return [];
  return positions.filter((p) => p && Number(p.sz) !== 0);
}

// ---------- 平仓历史（perps/positions 权威 realized_pnl / 资金费 / 均价）----------
export async function fetchPositionHistory(env, accountId) {
  const json = await httpGetJson(`${env.data}/api/v1/perps/positions?account_id=${encodeURIComponent(accountId)}`);
  return { records: toPositionHistoryRecords(json?.data), raw: json };
}
