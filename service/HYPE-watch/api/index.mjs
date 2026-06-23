// IO 层（接口收口）：Hyperliquid info REST（POST）+ 共享限流 + Telegram + meta universe 缓存。
// 纯 REST，不含 WS（WS polyfill 在 process/watcher.mjs）。HYPE 全程用 address，无 accountId 解析。
// 共享可变状态（sharedRateLimitUntil / watcherRegistry / meta 缓存）经 ES module live binding 供 watcher 读写。
import { installFetchProxy } from "../../lib/WARP/index.mjs";

// fetch 走代理（WARP；仅 HTTP_PROXY 存在时生效）
await installFetchProxy();

// ---------- 环境配置 ----------
export const ENVS = {
  production: {
    info: "https://api.hyperliquid.xyz/info",
    ws: "wss://api.hyperliquid.xyz/ws",
  },
};

// 429 限流（HYPE info 按 IP weight 限流）
export const THROTTLE_STATUSES = new Set([429]);

const REQUEST_TIMEOUT_MS = 10_000;
export const META_REFRESH_MS = 6 * 60 * 60 * 1_000; // 与 sodex SYMBOLS_REFRESH_MS 一致
const TG_TIMEOUT_MS = 8_000;
export const SEEN_IDS_CAP = 2000;

// ---------- 日志 ----------
const ts = () => new Date().toISOString().slice(11, 19);
export const log = (...a) => console.log(ts(), ...a);

export function parseJsonSafe(text) {
  return JSON.parse(text);
}

function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(headerVal);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// HYPE info 端点统一 POST {type, ...}
export async function infoPost(env, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(env.info, {
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

// 账户级读取（只读，零鉴权，按 address）
export const fetchClearinghouseState = (env, address) => infoPost(env, { type: "clearinghouseState", user: address });
export const fetchFrontendOpenOrders = (env, address) => infoPost(env, { type: "frontendOpenOrders", user: address });
export const fetchUserFills = (env, address) => infoPost(env, { type: "userFills", user: address });

// ---------- 模块级共享限流（多地址聚合 QPS 受控，一处 429 全员退避）----------
export let sharedRateLimitUntil = 0;
export let sharedBackoff = 0;
let sharedWakeScheduled = false;
export const watcherRegistry = new Set();

export function nextSharedBackoffMs() {
  sharedBackoff = Math.min((sharedBackoff || 1) * 2, 60);
  const base = sharedBackoff * 1000;
  return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
}

export function resetSharedBackoff() { sharedBackoff = 0; }

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

// ---------- meta universe 缓存（coin → szDecimals，下单 index 暂不需要，仅读用）----------
let szDecimalsByCoin = new Map();
const DEFAULT_SZ_DECIMALS = 4;

export async function refreshMeta(env) {
  const json = await infoPost(env, { type: "meta" });
  const universe = Array.isArray(json?.universe) ? json.universe : [];
  const next = new Map();
  for (const u of universe) next.set(String(u.name), Number(u.szDecimals));
  if (next.size) { szDecimalsByCoin = next; log(`meta 缓存已更新：${next.size} 个 perps`); }
  else log("meta universe 为空，沿用旧缓存");
}

// HYPE perps 价格精度规则：MAX_DECIMALS(6) - szDecimals
export function szDecimalsOf(coin) {
  return szDecimalsByCoin.has(String(coin)) ? szDecimalsByCoin.get(String(coin)) : DEFAULT_SZ_DECIMALS;
}
