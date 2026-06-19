#!/usr/bin/env node
// 监听某钱包 address 的 perps 账户变化（事件驱动，非轮询）。
// 当前持仓直接取自 WS accountState 快照；平仓历史/离场挂单在变化时用 REST 拉取。
//
// 依赖 ws 包（npm install ws）；无 SDK、无鉴权。代理(WARP)另需 undici + https-proxy-agent。
//
// 请求控制（防 429/409 限流、防多发/漏发）：
//   1. 指纹去重 — 规范化比对（abs(size)+派生方向+离场单集合+排序），消除表示/顺序漂移误判
//   2. 防抖合并 — 默认 3000ms + maxWait 5000ms 封顶，活跃流不饥饿
//   3. 限流退避 — 429/409 优先 Retry-After，否则指数 2→60s + jitter；模块级共享，一处限流全员退避
//   4. 失败兜底 — 拉取失败不渲染空数据，保留指纹待下次成功（不误报）
//   5. 暂缓重试 — CLOSED 仓位但平仓历史尚无对应记录时等 2s 补拉（positions 索引延迟）
//
// 用法：
//   单地址：node watch-account.mjs 0xYourAddress
//   单地址快照：node watch-account.mjs 0xYourAddress --snapshot
//   多地址：node watch-account.mjs --config=script/watch.config.json
//   Telegram：--tg-token=BOT_TOKEN --tg-chat=CHAT_ID（单地址）

import { readFileSync } from "node:fs";

// 代理支持：Node 22 内置 fetch/WebSocket 不认 HTTP_PROXY 环境变量，需显式处理
const PROXY_URL = process.env.HTTP_PROXY || process.env.http_proxy || null;

// fetch 走代理（undici ProxyAgent，Node 22 fetch 底层即 undici）
if (PROXY_URL) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
    console.error(`[proxy] fetch 走代理 ${PROXY_URL}`);
  } catch {
    console.error("警告：未安装 undici，fetch 不走代理（真实 IP 会暴露）\n  npm install undici");
  }
}

// WebSocket 走代理（Node 22 内置 WS 不支持 HTTP CONNECT 代理，统一用 ws 包）
try {
  const WS = (await import("ws")).default || (await import("ws")).WebSocket;
  const WSBase = WS.prototype ? WS : WS.WebSocket;
  let wsAgent = undefined;
  if (PROXY_URL) {
    try {
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      wsAgent = new HttpsProxyAgent(PROXY_URL);
      console.error(`[proxy] WebSocket 走代理 ${PROXY_URL}`);
    } catch {
      console.error("警告：未安装 https-proxy-agent，WebSocket 不走代理（真实 IP 会暴露）\n  npm install https-proxy-agent");
    }
  }
  globalThis.WebSocket = function (url, protocols) {
    const opts = { handshakeTimeout: 10000, headers: { "User-Agent": "node" } };
    if (wsAgent) opts.agent = wsAgent;
    return new WSBase(url, protocols, opts);
  };
} catch {
  console.error("需要安装 ws 包:\n  npm install ws");
  process.exit(1);
}

// ---------- 环境配置 ----------
const ENVS = {
  production: {
    gatewayWs: "wss://mainnet-gw.sodex.dev",
    gateway: "https://mainnet-gw.sodex.dev",
    data: "https://mainnet-data.sodex.dev",
    biz: "https://alpha-biz.sodex.dev",
    bizEnv: "mainnet",
    chain: "https://sodex.dev/mainnet",
  },
};

const CHANNELS = ["accountState", "accountUpdate", "accountOrderUpdate", "accountTrade"];

// 429/409 同属限流家族（409 为本网关实测限流码，非标准 Conflict 语义）
const THROTTLE_STATUSES = new Set([429, 409]);

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SYMBOLS_REFRESH_MS = 6 * 60 * 60 * 1_000;
const TG_TIMEOUT_MS = 8_000;
const SEEN_IDS_CAP = 2000; // seenPositionIds 上限，超出用当前数据重建防长跑泄漏

// ---------- 通用工具 ----------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else positional.push(arg);
  }
  return { address: positional[0], flags };
}

function isAddress(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

// 每日快照时间格式校验：HH:MM（0-23 : 0-59）。config / CLI 写错时不致定时器失效。
// 短地址：0x前6...后4（如 0xbead...1c8a）
export function shortAddress(address) {
  if (!address || typeof address !== "string" || address.length < 10) return address ?? "?";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isValidHHMM(v) {
  if (typeof v !== "string") return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

// 每日快照时间取值优先级：地址项 at > CLI --at > 默认 20:00；非法值跳过回退下一级。
export function pickAt(watchAt, cliAt) {
  if (isValidHHMM(watchAt)) return watchAt;
  if (isValidHHMM(cliAt)) return cliAt;
  return "20:00";
}

function parseJsonSafe(text) {
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

// ---------- 统一格式化工具（千分位 + 去尾零，console / TG 两端共用）----------
// 空值判定：null / undefined / "" → 缺失（显示 "-"，不当 0）
const isBlank = (v) => v === null || v === undefined || v === "";

// 数字：千分位 + 最多 maxDecimals 位小数，尾部 0 自动删减（toLocaleString 默认 trim）；缺失/非有限 → "-"
export function fmtNum(value, maxDecimals = 2) {
  if (isBlank(value)) return "-";
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  return x.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

// USD 金额：负号在 $ 前（-$0.26）；signed 时正数加 +；缺失/非有限 → "-"
export function fmtUsd(value, signed = false) {
  if (isBlank(value)) return "-";
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : signed && x > 0 ? "+" : ""; // 0 不带符号
  return `${sign}$${fmtNum(Math.abs(x), 2)}`;
}

// 百分比：带符号（+/-），2 位去尾零；缺失/非有限 → "-"
export function fmtPct(value) {
  if (isBlank(value)) return "-";
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : x > 0 ? "+" : ""; // 0 不带符号
  return `${sign}${fmtNum(Math.abs(x), 2)}%`;
}

// 统一事件时间：YYYY/MM/DD HH:mm:ss（上海 UTC+8）；入参 ms 时间戳，缺省取当前
export function fmtTime(tsMs) {
  const d = tsMs == null ? new Date() : new Date(Number(tsMs));
  if (Number.isNaN(d.getTime())) return "-";
  // sv-SE → "2026-06-18 10:45:48"，仅日期段是 "-"（时间段用 ":"），全替换为 "/"
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/-/g, "/");
}

// 方向中文映射（仓位方向只有 LONG / SHORT / BOTH，BOTH 已在 positionDirection 按符号判定）
const DIRECTION_CN = { LONG: "做多", SHORT: "做空" };
export const directionCN = (dir) => DIRECTION_CN[dir] ?? dir;

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), ...a);

async function httpGetJson(url) {
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
let sharedRateLimitUntil = 0;
let sharedBackoff = 0;
let sharedWakeScheduled = false;
const watcherRegistry = new Set();

// 限流退避（秒级翻倍封顶 60s）+ ±20% jitter，防多实例同步重试惊群
function nextSharedBackoffMs() {
  sharedBackoff = Math.min((sharedBackoff || 1) * 2, 60);
  const base = sharedBackoff * 1000;
  return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
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

function enterSharedRateLimit(waitMs) {
  sharedRateLimitUntil = Math.max(sharedRateLimitUntil, Date.now() + waitMs);
  scheduleSharedWake();
}

// ---------- Telegram 推送 ----------
async function sendTelegram(token, chatId, text) {
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

// 构建 Telegram 消息（样式 F 卡片）。banner 头一行 + 仓位卡片(含离场挂单) + 平仓历史。
function buildTgMessage(displayId, kind, clock, positions, reduceOnly, posHistory, newPosIds, limit) {
  const lines = [];
  const SEP = "━━━━━━━━━━━━━━━━";

  // 1) banner 头（去重：明细行已删，动作由头部动词表达）
  lines.push(bannerHead(displayId, kind, clock));

  // 2) 仓位卡片（末尾追加该仓离场挂单）
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (open.length) {
    for (const p of open) {
      const v = derivePositionView(p);
      lines.push(`\n${SEP}`);
      lines.push(`📊 仓位：${v.coin} ${v.lev}x ${v.dir}`);
      lines.push(`  方向  ${v.dirCN}`);
      lines.push(`  持仓量  ${fmtNum(v.absSize, v.qtyPrecision)}`);
      lines.push(`  仓位价值  ${v.value !== null ? fmtUsd(v.value) : "-"}`);
      lines.push(`  开仓价  ${fmtNum(v.entry, v.pricePrecision)}`);
      lines.push(`  标记价  ${v.mark !== null ? fmtNum(v.mark, v.pricePrecision) : "-"}`);
      lines.push(`  未结盈亏  ${fmtUsd(v.uPnl, true)}${v.roe !== null ? ` (${fmtPct(v.roe)})` : ""}`);
      lines.push(`  强平价  ${fmtNum(v.liqPrice, v.pricePrecision)}`);
      if (v.margin !== null) lines.push(`  保证金  ${fmtUsd(v.margin)} (${marginModeLabel(v.marginMode)})`);
      for (const line of exitOrderLines(p, v, reduceOnly)) lines.push(`  ${line}`);
      lines.push(`${SEP}`);
    }
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }

  // 3) 平仓历史
  const history = renderPositionHistory(posHistory, newPosIds, limit);
  if (history) lines.push(`\n${history}`);

  return lines.join("\n");
}

// 离场挂单变化轻提醒（独立 banner）。changes: { placed, modified, canceled }（含 view/mark 上下文）
function buildExitOrderBanner(displayId, clock, changes) {
  const verb = { place: "设置", cancel: "撤销", modify: "调整" };
  const lines = [`⚡ 【${displayId}】 离场挂单 · ${clock}`];
  for (const c of changes) {
    const tag = c.label ? `${c.label} ` : "";
    lines.push(`${verb[c.action]} ${tag}${c.coin} ${c.dirCN} @ ${c.priceStr}`);
  }
  return lines.join("\n");
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

async function refreshSymbols(env) {
  const json = await httpGetJson(`${env.biz}/biz/futures/symbols?env=${env.bizEnv}`);
  const list = Array.isArray(json?.data) ? json.data : [];
  const byId = new Map();
  const bySym = new Map();
  for (const s of list) { const m = buildSymbolMeta(s); byId.set(Number(s.id), m); bySym.set(String(s.symbol), m); }
  if (byId.size) { symbolsById = byId; symbolsBySymbol = bySym; log(`符号缓存已更新：${byId.size} 个 perps 交易对`); }
  else log("符号列表为空，沿用旧缓存");
}

const DEFAULT_META = { name: "?", baseCoin: "", quoteCoin: "", pricePrecision: 4, quantityPrecision: 6, feePrecision: 4 };

function symbolMeta(symbolId) {
  return symbolsById.get(Number(symbolId)) ?? { ...DEFAULT_META, name: `#${symbolId}` };
}

function symbolMetaBySymbol(symbol) {
  return symbolsBySymbol.get(String(symbol)) ?? { ...DEFAULT_META, name: baseCoin(symbol), quoteCoin: "USDC" };
}

// ---------- WS 快照仓位 / 离场单解析 ----------
function parseWsPosition(p) {
  return {
    symbol: String(p.s ?? p.symbol ?? "?"),
    posSide: String(p.ps ?? p.positionSide ?? ""),
    size: String(p.sz ?? p.size ?? "0"),
    entry: String(p.ep ?? p.avgEntryPrice ?? ""),
    unrealizedPnl: String(p.ur ?? p.unrealizedPnl ?? "0"),
    realizedPnl: String(p.cr ?? p.realizedPnL ?? "0"),
    leverage: Number(p.l ?? p.leverage ?? 0),
    liqPrice: String(p.lp ?? p.liquidationPrice ?? ""),
    marginMode: String(p.m ?? p.marginMode ?? ""),
  };
}

// 离场单（reduceOnly，R:true）归一化。WS data.O 字段：i 单号 / s 币 / S BUY|SELL /
// p 价 / q 量 / z 已成交 / ps LONG|SHORT|BOTH / o 类型 / X 状态。开仓单(R:false)不取。
function parseReduceOnlyOrders(orders) {
  if (!Array.isArray(orders)) return [];
  return orders.filter((o) => o && o.R === true).map((o) => ({
    orderId: String(o.i),
    symbol: String(o.s ?? "?"),
    side: String(o.S ?? ""),
    posSide: String(o.ps ?? ""),
    price: String(o.p ?? ""),
    qty: String(o.q ?? ""),
    filled: String(o.z ?? "0"),
    type: String(o.o ?? ""),
    status: String(o.X ?? ""),
  }));
}

// 离场单规范化指纹：只取 R:true，i+p+q 排序拼接（不含开仓单，避免 churn）。
export function canonicalReduceOnlyOrders(orders) {
  if (!Array.isArray(orders)) return "";
  return orders
    .filter((o) => o && o.R === true)
    .map((o) => `${o.i}:${o.p}:${o.q}`)
    .sort()
    .join(",");
}

const baseCoin = (symbol) => String(symbol).split(/[-/]/)[0];

function positionDirection(p) {
  if (p.posSide === "LONG" || p.posSide === "SHORT") return p.posSide;
  return Number(p.size) < 0 ? "SHORT" : "LONG";
}

// 仓位指纹：规范化后再比对（abs(size) + 派生方向 + 按 symbol 排序），
// 消除"表示/数组顺序漂移被误判为变化"导致的重复触发/重复上报。
function canonicalPositionsFp(positions) {
  return positions
    .filter((p) => Number(p.size) !== 0)
    .map((p) => `${p.symbol}:${positionDirection(p)}:${Math.abs(Number(p.size))}`)
    .sort()
    .join(",");
}

function marginModeLabel(m) {
  if (/cross/i.test(m)) return "Cross";
  if (/iso/i.test(m)) return "Isolated";
  return m || "-";
}

// 共享持仓派生层：console + TG 两端统一口径，防 mark/方向/价值 重复实现导致漂移。
// 标记价不在账户快照里 → 用 mark = 开仓价 + 未结盈亏/带符号数量 反推（与展示盈亏天然一致）。
export function derivePositionView(p) {
  const meta = symbolMetaBySymbol(p.symbol);
  const dir = positionDirection(p); // LONG / SHORT
  const absSize = Math.abs(Number(p.size));
  const signedSize = dir === "SHORT" ? -absSize : absSize;
  const lev = p.leverage || 0;
  // 空字符串视为缺失（→ NaN），避免 Number("")=0 反推出 mark=0 的假值
  const entry = isBlank(p.entry) ? NaN : Number(p.entry);
  const uPnl = Number(p.unrealizedPnl);
  // 反推标记价：ur = (mark - entry) × signedSize → mark = entry + ur/signedSize
  const mark =
    Number.isFinite(entry) && Number.isFinite(uPnl) && signedSize !== 0
      ? entry + uPnl / signedSize
      : null; // 兜底：无法反推 → null（标记价 / 仓位价值均显示 "-"）
  const value = mark !== null && Number.isFinite(absSize) ? absSize * mark : null;
  const margin = lev > 0 && Number.isFinite(entry) ? (absSize * entry) / lev : null;
  const roe = margin && margin > 0 ? (uPnl / margin) * 100 : null;
  return {
    coin: meta.baseCoin || baseCoin(p.symbol),
    dir,
    dirCN: directionCN(dir),
    absSize,
    lev,
    entry,
    mark,
    value,
    uPnl,
    margin,
    roe,
    liqPrice: Number(p.liqPrice),
    marginMode: p.marginMode,
    pricePrecision: meta.pricePrecision,
    qtyPrecision: Math.min(meta.quantityPrecision, 6),
  };
}

// 匹配某仓的离场单并生成展示行（仓位卡片末尾）。
// 方向匹配：hedge 按 ps；单向/BOTH 按 side（SELL→平多, BUY→平空）。
// TP/SL 推断（G11）：多单 SELL 价>标记→止盈、<→止损；空单反之；mark 反推不出→退化无标签。
export function exitOrderLines(position, view, reduceOnly) {
  const matches = matchReduceOnly(position, view, reduceOnly);
  return matches.map((o) => {
    const label = exitTpSlLabel(view, o);
    const qty = Number(o.qty);
    const full = Number.isFinite(qty) && Number.isFinite(view.absSize) && qty >= view.absSize - 1e-12;
    const qtyStr = fmtNum(o.qty, view.qtyPrecision);
    const amt = full ? `全平 ${qtyStr}` : `部分 ${qtyStr} / ${fmtNum(view.absSize, view.qtyPrecision)}`;
    const labelPart = label ? `${label} ` : "";
    return `离场挂单  ${labelPart}@ ${fmtNum(o.price, view.pricePrecision)} (${amt})`;
  });
}

function matchReduceOnly(position, view, reduceOnly) {
  return reduceOnly.filter((o) => {
    if (baseCoin(o.symbol) !== baseCoin(position.symbol)) return false;
    if (o.posSide === "LONG" || o.posSide === "SHORT") return o.posSide === view.dir;
    const closes = o.side === "SELL" ? "LONG" : o.side === "BUY" ? "SHORT" : null;
    return closes === view.dir;
  });
}

// TP/SL 标签：需要 mark 才能判；mark null（G11）或价非法 → 返回 ""（不带标签）
function exitTpSlLabel(view, order) {
  const price = Number(order.price);
  if (view.mark === null || !Number.isFinite(price)) return "";
  const isTp = view.dir === "LONG" ? price > view.mark : price < view.mark;
  return isTp ? "止盈" : "止损";
}

// banner 文案：动词化仓位状态，全部带【displayId】
const BANNER_LABEL = {
  START: "START WATCH",
  OPEN: "OPEN POSITION",
  CLOSE: "CLOSE POSITION",
  INCREASE: "INCREASE POSITION",
  REDUCE: "REDUCE POSITION",
  UPDATE: "POSITION UPDATE",
  CHANGE: "POSITION CHANGE",
  SNAPSHOT: "SNAPSHOT",
};

function bannerHead(displayId, kind, clock) {
  const label = BANNER_LABEL[kind] ?? "POSITION CHANGE";
  return `⚡ 【${displayId}】 ${label} · ${clock}`;
}

// 由仓位 diff events 判定 banner 类型（START / SNAPSHOT 由调用方按 baseline/reason 决定）。
// 删 trades 后不再有 newFills，动词全部来自 diffPositions 的 events。
function classifyBanner(events) {
  const verbs = events.map((e) => e.split(" ")[0]);
  if (verbs.includes("OPENED")) return { kind: "OPEN" };
  if (verbs.includes("CLOSED")) return { kind: "CLOSE" };
  if (verbs.includes("INCREASED")) return { kind: "INCREASE" };
  if (verbs.includes("DECREASED")) return { kind: "REDUCE" };
  return { kind: "CHANGE" }; // 无仓位 diff（如纯离场单变化）→ 兜底
}

async function resolveAccountIdViaChain(env, address) {
  const resp = await httpGetJson(`${env.chain}/chain/address/${address}/accounts`).catch(() => null);
  if (resp?.code !== 0 || !resp?.data) return null;
  return resp.data.primaryAccountId ?? null;
}

// ---------- 平仓历史（perps/positions 权威 realized_pnl / 资金费 / 均价）----------
// G4 数字枚举映射（与 WS 字符串 ps/m 不同源，平仓历史走自己的数字映射）：
const POSITION_SIDE_CN = { 2: "做多", 3: "做空" }; // 2=LONG / 3=SHORT；1 未观测，兜底原值
const MARGIN_MODE_NUM = { 1: "Isolated", 2: "Cross" }; // 实测全为 2=Cross

export function positionSideCN(side) {
  return POSITION_SIDE_CN[Number(side)] ?? `side${side}`;
}

export function marginModeNumLabel(m) {
  return MARGIN_MODE_NUM[Number(m)] ?? String(m);
}

// G3：接口按 position_id 返回（非平仓时间），pid 小但 updated_at 新会排后
// → 客户端按 updated_at 降序排序后再取最近 N。仅取已平仓（size=0）。
export function toPositionHistoryRecords(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => Number(r.size) === 0)
    .map((r) => ({
      positionId: String(r.position_id),
      symbolId: Number(r.symbol_id),
      positionSide: Number(r.position_side),
      marginMode: Number(r.margin_mode),
      maxSize: r.max_size,
      cumClosedSize: r.cum_closed_size,
      avgEntryPrice: r.avg_entry_price,
      avgClosePrice: r.avg_close_price,
      realizedPnl: r.realized_pnl,
      fundingFee: r.funding_fee,
      updatedAt: Number(r.updated_at),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function fetchPositionHistory(env, accountId) {
  const json = await httpGetJson(`${env.data}/api/v1/perps/positions?account_id=${encodeURIComponent(accountId)}`);
  return { records: toPositionHistoryRecords(json?.data), raw: json };
}

// 平仓历史渲染（中文「平仓历史」，每条两行 + ★ 标新）。无记录返回 null。
function renderPositionHistory(records, newIds, limit) {
  const list = (records ?? []).slice(0, limit);
  if (!list.length) return null;
  const lines = [`📜 平仓历史 (最近${list.length}条)\n`];
  for (const r of list) {
    const meta = symbolMeta(r.symbolId);
    const coin = meta.baseCoin || `#${r.symbolId}`;
    const star = newIds && newIds.has(r.positionId) ? "★ " : "";
    const full = Math.abs(Number(r.cumClosedSize)) >= Math.abs(Number(r.maxSize)) - 1e-12;
    lines.push(`  ${star}${fmtTime(r.updatedAt)}  ${coin} ${positionSideCN(r.positionSide)} · ${full ? "全平" : "部分"}`);
    lines.push(`  开仓 ${fmtNum(r.avgEntryPrice, meta.pricePrecision)} → 平仓 ${fmtNum(r.avgClosePrice, meta.pricePrecision)}  数量 ${fmtNum(r.cumClosedSize, meta.quantityPrecision)}`);
    lines.push(`  已实现盈亏 ${fmtUsd(r.realizedPnl, true)}  资金费 ${fmtUsd(r.fundingFee, true)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function diffPositions(prev, curr) {
  const open = (arr) => arr.filter((p) => Number(p.size) !== 0);
  const key = (p) => `${baseCoin(p.symbol)}:${positionDirection(p)}`;
  const pm = new Map(open(prev).map((p) => [key(p), p]));
  const cm = new Map(open(curr).map((p) => [key(p), p]));
  const events = [];
  for (const [k, p] of cm) {
    const dir = positionDirection(p);
    const amt = Math.abs(Number(p.size));
    const b = pm.get(k);
    if (!b) events.push(`OPENED ${dir} ${baseCoin(p.symbol)} ${amt} @ ${p.entry}`);
    else if (b.size !== p.size) {
      const grew = Math.abs(Number(p.size)) > Math.abs(Number(b.size));
      events.push(`${grew ? "INCREASED" : "DECREASED"} ${dir} ${baseCoin(p.symbol)} ${Math.abs(Number(b.size))}→${amt}`);
    }
  }
  for (const [k, p] of pm) if (!cm.has(k)) events.push(`CLOSED ${positionDirection(p)} ${baseCoin(p.symbol)}`);
  return events;
}

// 离场单集合 diff（G9/G10）：按 orderId 比对得出 PLACE / MODIFY / CANCEL。
// G9 MODIFY：同 orderId 的 p/q 变 → 一条"调整"；交易所撤旧+新单实现改单时退化为 CANCEL+PLACE（可接受）。
export function diffReduceOnly(prevMap, currList) {
  const placed = [];
  const modified = [];
  const canceled = [];
  const currIds = new Set();
  for (const o of currList) {
    currIds.add(o.orderId);
    const prev = prevMap.get(o.orderId);
    if (!prev) placed.push(o);
    else if (prev.price !== o.price || prev.qty !== o.qty) modified.push(o);
  }
  for (const [id, o] of prevMap) if (!currIds.has(id)) canceled.push(o);
  return { placed, modified, canceled };
}

function renderPositions(positions, reduceOnly) {
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (!open.length) return "  （无持仓）";
  const header = ["Coin", "方向", "持仓量", "仓位价值", "Entry", "Mark", "Unrealized PnL (ROE%)", "Liq.Price", "Margin", "离场挂单"];
  const rows = open.map((p) => {
    const v = derivePositionView(p);
    const pnlStr = fmtUsd(v.uPnl, true) + (v.roe !== null ? ` (${fmtPct(v.roe)})` : "");
    // console 表格列头已是「离场挂单」，剥掉每行同名前缀避免双重标签（TG 卡片无列头，不剥）
    const exit = exitOrderLines(p, v, reduceOnly ?? []).map((l) => l.replace(/^离场挂单\s+/, "")).join(" / ") || "-";
    return [
      `${v.coin} ${v.lev}x ${v.dir}`,
      v.dirCN,
      `${fmtNum(v.absSize, v.qtyPrecision)} ${v.coin}`,
      v.value !== null ? fmtUsd(v.value) : "-",
      fmtNum(v.entry, v.pricePrecision),
      v.mark !== null ? fmtNum(v.mark, v.pricePrecision) : "-",
      pnlStr,
      fmtNum(v.liqPrice, v.pricePrecision),
      v.margin !== null ? `${fmtUsd(v.margin)} (${marginModeLabel(v.marginMode)})` : "-",
      exit,
    ];
  });
  const w = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

function displayWidth(str) {
  let w = 0;
  for (const ch of str) { const cp = ch.codePointAt(0); w += cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) ? 2 : 1; }
  return w;
}

function boxBanner(lines) {
  const w = Math.max(...lines.map(displayWidth));
  const bar = "═".repeat(w + 2);
  const body = lines.map((l) => `║ ${l}${" ".repeat(w - displayWidth(l))} ║`);
  return [`╔${bar}╗`, ...body, `╚${bar}╝`].join("\n");
}

// console banner = 头部一行（明细行已删，banner 去重）
function buildEventBanner(displayId, kind, clock) {
  return boxBanner([bannerHead(displayId, kind, clock)]);
}

// ---------- 监听器 ----------
class AccountWatcher {
  constructor(env, address, flags) {
    this.env = env;
    this.address = address;
    this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
    this.debounceMs = Number(flags["debounce-ms"] ?? 3000);
    this.maxWaitMs = Number(flags["max-wait-ms"] ?? 5000);
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.label = flags.label ?? null;
    this.at = pickAt(flags.at, undefined); // 非法 --at 回退默认 20:00
    this.forceReport = false;
    this.dailyTimer = null;
    this.tgReason = "event";
    this.retryScheduled = false;
    this.ws = null;
    this.requestId = 0;
    this.reconnectAttempt = 0;
    this.pingTimer = null;
    this.pongTimer = null;
    this.debounceTimer = null;
    this.firstPendingAt = 0;
    this.closing = false;
    this.fetching = false;
    this.positions = [];
    this.ordersRaw = [];
    this.lastPositions = [];
    this.seenPositionIds = new Set();
    this.prevReduceOnly = new Map(); // orderId → 归一化单（G10 离场单 diff）
    this.baselineLogged = false;
    this.stateFp = null;
    this.lastOutFp = null;
  }

  // 有 label 显示 label，无 label 显示短地址
  makeDisplayId() {
    return this.label ?? shortAddress(this.address);
  }

  start() { watcherRegistry.add(this); this.connect(); }

  connect() {
    const url = `${this.env.gatewayWs}/ws/perps`;
    log(`连接 ${url}（无鉴权）`);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      log("OPEN，订阅账户频道");
      for (const channel of CHANNELS) this.send({ op: "subscribe", id: ++this.requestId, params: { channel, user: this.address } });
      this.startPing();
      this.scheduleDaily();
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = (ev) => { this.clearTimers(); if (this.closing) return; log(`CLOSE code=${ev.code}，准备重连`); this.scheduleReconnect(); };
    ws.onerror = (ev) => log("WS ERROR:", ev?.message || ev?.type || ev);
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  startPing() {
    this.clearTimers();
    this.pingTimer = setInterval(() => { this.send({ op: "ping" }); this.pongTimer = setTimeout(() => { log("pong 超时，断开重连"); try { this.ws?.close(); } catch {} }, PONG_TIMEOUT_MS); }, PING_INTERVAL_MS);
  }

  clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.pingTimer = null; this.pongTimer = null; this.dailyTimer = null;
  }

  scheduleReconnect() {
    const exp = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    const delay = Math.round(exp + exp * 0.2 * (Math.random() * 2 - 1));
    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }

  scheduleDaily() {
    const ms = msUntilNextShanghai(this.at);
    this.dailyTimer = setTimeout(() => { this.forceReport = true; this.lastOutFp = null; this.tgReason = "daily"; this.scheduleFetch(); this.scheduleDaily(); }, ms);
    log(`下次每日快照：${this.at} 上海时间（约 ${Math.round(ms / 60000)} 分钟后）`);
  }

  handleMessage(raw) {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    let msg;
    try { msg = parseJsonSafe(typeof raw === "string" ? raw : String(raw)); } catch { return; }
    if (msg.op === "pong") return;
    if (msg.op === "subscribe" || msg.op === "unsubscribe") { if (msg.success === false) log(`订阅失败：${msg.error ?? "unknown"}`); return; }
    if (!msg.channel) return;
    if (this.flags.raw) log(`RECV [${msg.channel}] type=${msg.type ?? "update"}`);

    if (msg.channel === "accountState") {
      const data = msg.data ?? {};
      if (!this.accountId) { const aid = data.aid ?? data.accountId ?? data.account_id ?? null; if (aid) { this.accountId = String(aid); log(`accountId = ${this.accountId}（来自 WS 快照）`); } }
      this.positions = Array.isArray(data.P) ? data.P.map(parseWsPosition) : [];
      this.ordersRaw = Array.isArray(data.O) ? data.O : [];
      // 触发指纹 = 仓位身份 + 离场单集合（reduceOnly 挂/改/撤即时触发；开仓单不计，避免 churn）
      const fp = canonicalPositionsFp(this.positions) + "|" + canonicalReduceOnlyOrders(this.ordersRaw);
      if (fp !== this.stateFp) { this.stateFp = fp; this.scheduleFetch(); }
      return;
    }
    // 成交 / 订单推送只作"重新评估"提示，状态以 accountState 全量快照为准
    if (msg.channel === "accountTrade" || msg.channel === "accountOrderUpdate") this.scheduleFetch();
  }

  scheduleFetch() {
    if (Date.now() < sharedRateLimitUntil) return;
    const now = Date.now();
    if (this.firstPendingAt === 0) this.firstPendingAt = now;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // maxWait 封顶：自首个待处理事件起超过 maxWaitMs 立即 flush，
    // 避免活跃成交流（事件间隔<debounceMs）让 trailing 防抖一直被推后而饥饿。
    const waited = now - this.firstPendingAt;
    if (waited >= this.maxWaitMs) { this.flushFetch(); return; }
    const delay = Math.min(this.debounceMs, this.maxWaitMs - waited);
    this.debounceTimer = setTimeout(() => this.flushFetch(), delay);
  }

  flushFetch() {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.firstPendingAt = 0;
    this.fetchAndReport();
  }

  async fetchAndReport() {
    if (this.fetching) { this.scheduleFetch(); return; }
    // 冷却兜底：限流前已 armed 的 debounceTimer 可能在冷却期内 fire，
    // 此处再 gate 一次，避免在 sharedRateLimitUntil 内打出请求又触发限流。
    if (Date.now() < sharedRateLimitUntil) return;
    this.fetching = true;
    try {
      if (!this.accountId) { this.accountId = await resolveAccountIdViaChain(this.env, this.address); if (!this.accountId) { log("无法解析 accountId，跳过"); return; } log(`accountId = ${this.accountId}（来自 chain api）`); }
      let result = null;
      try {
        result = await fetchPositionHistory(this.env, this.accountId);
        sharedBackoff = 0;
      } catch (err) {
        log(`[平仓历史拉取失败] ${err.message}`);
        if (THROTTLE_STATUSES.has(err.status)) {
          // 限流：优先服务端 Retry-After，否则指数退避 + jitter；模块级 gate 全员；
          // 冷却结束由 scheduleSharedWake 唤醒全部 watcher（G2），不在此处单实例 setTimeout。
          const waitMs = err.retryAfterMs ?? nextSharedBackoffMs();
          enterSharedRateLimit(waitMs);
          log(`触发限流(${err.status})，${Math.round(waitMs / 1000)}s 后全员恢复`);
        }
      }
      // 拉取失败（限流/硬错误）：不渲染空数据，保留 lastOutFp / forceReport 待下次成功（不误报）
      if (result === null) return;

      const records = result.records ?? [];
      const reduceOnly = parseReduceOnlyOrders(this.ordersRaw);
      // G1：出参去重须含 reduceOnly + 平仓 position_id 集，否则纯挂单变化(仓位/平仓均无变)被去重 → 即时提醒失效
      const closedIdsFp = records.map((r) => r.positionId).sort().join(",");
      const outFp = canonicalPositionsFp(this.positions) + "|" + canonicalReduceOnlyOrders(this.ordersRaw) + "|" + closedIdsFp;
      const force = this.forceReport; this.forceReport = false;
      if (!force && outFp === this.lastOutFp) return;
      this.lastOutFp = outFp;

      const events = diffPositions(this.lastPositions, this.positions);
      this.lastPositions = this.positions;

      // ★ 复用：首帧基线全部不标，之后新出现的已平仓位（新 position_id）标 ★
      const newPosIds = new Set();
      for (const r of records) { if (!this.seenPositionIds.has(r.positionId)) { this.seenPositionIds.add(r.positionId); if (this.baselineLogged) newPosIds.add(r.positionId); } }
      if (this.seenPositionIds.size > SEEN_IDS_CAP) this.seenPositionIds = new Set(records.map((r) => r.positionId));
      const isBaseline = !this.baselineLogged;
      this.baselineLogged = true;

      // G5/G6：检测到 CLOSED 仓位事件但平仓历史尚无对应新 position_id → positions 索引延迟，2s 补拉
      const hasClosed = events.some((e) => e.startsWith("CLOSED"));
      if (!force && !isBaseline && hasClosed && newPosIds.size === 0) {
        if (!this.retryScheduled) { this.retryScheduled = true; this.lastOutFp = null; setTimeout(() => { this.retryScheduled = false; this.scheduleFetch(); }, 2000); }
        return;
      }
      this.retryScheduled = false;

      // 离场单变化提醒（独立 banner）；首帧只建立基线，不提醒
      const exitChanges = isBaseline ? [] : this.computeExitChanges(reduceOnly, events);
      this.prevReduceOnly = new Map(reduceOnly.map((o) => [o.orderId, o]));

      // banner 类型：首帧→START WATCH；每日 force→SNAPSHOT；否则按仓位 diff 动词化
      const { kind } = isBaseline
        ? { kind: "START" }
        : this.tgReason === "daily"
          ? { kind: "SNAPSHOT" }
          : classifyBanner(events);
      const clock = fmtTime();
      const displayId = this.makeDisplayId();

      console.log(""); console.log(buildEventBanner(displayId, kind, clock)); log(`account_id=${this.accountId}`);
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(this.positions, reduceOnly));
      const histText = renderPositionHistory(records, newPosIds, this.historyLimit);
      console.log("\n--- 平仓历史 Position History ---"); console.log(histText ?? "  （无平仓记录）");
      if (this.flags.raw && result?.raw) { console.log("\n--- raw positions ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const tgText = buildTgMessage(displayId, kind, clock, this.positions, reduceOnly, records, newPosIds, this.historyLimit);
      this.tgReason = "event";
      sendTelegram(this.tgToken, this.tgChat, tgText);

      // 离场单提醒在主报告之后单发，便于 TG 区分"账户状态" vs "前瞻信号"
      if (exitChanges.length) {
        const exitText = buildExitOrderBanner(displayId, clock, exitChanges);
        console.log(exitText + "\n");
        sendTelegram(this.tgToken, this.tgChat, exitText);
      }
    } finally { this.fetching = false; }
  }

  // 离场单 PLACE/MODIFY/CANCEL → 提醒条目。FILL 不双报：单消失且同窗口该 coin 仓位减/平 → 判成交，归平仓事件不报撤销。
  computeExitChanges(reduceOnly, events) {
    const { placed, modified, canceled } = diffReduceOnly(this.prevReduceOnly, reduceOnly);
    const reducedCoins = new Set(
      events.filter((e) => e.startsWith("DECREASED") || e.startsWith("CLOSED")).map((e) => e.split(" ")[2]),
    );
    const out = [];
    for (const o of placed) out.push(this.exitChangeEntry("place", o, reduceOnly));
    for (const o of modified) out.push(this.exitChangeEntry("modify", o, reduceOnly));
    for (const o of canceled) {
      if (reducedCoins.has(baseCoin(o.symbol))) continue; // 成交→平仓事件已表达，不发撤销提醒
      out.push(this.exitChangeEntry("cancel", o, reduceOnly));
    }
    return out;
  }

  // 单条离场变化的展示上下文（coin / 方向 / 价 / TP-SL 标签）。标签需对应持仓 mark，取不到则省略。
  exitChangeEntry(action, order, reduceOnly) {
    const closesDir = order.posSide === "LONG" || order.posSide === "SHORT"
      ? order.posSide
      : order.side === "SELL" ? "LONG" : order.side === "BUY" ? "SHORT" : "";
    const pos = this.positions.find((p) => baseCoin(p.symbol) === baseCoin(order.symbol) && Number(p.size) !== 0);
    const view = pos ? derivePositionView(pos) : null;
    const meta = symbolMetaBySymbol(order.symbol);
    const label = view ? exitTpSlLabel(view, order) : "";
    return {
      action,
      coin: meta.baseCoin || baseCoin(order.symbol),
      dirCN: directionCN(closesDir),
      priceStr: fmtNum(order.price, meta.pricePrecision),
      label,
    };
  }

  close() { watcherRegistry.delete(this); this.closing = true; this.clearTimers(); try { this.ws?.close(); } catch {} }
}

// ---------- Snapshot 模式（单地址；按需 + 每日定时）----------
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function msUntilNextShanghai(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const now = Date.now();
  const sh = new Date(now + SHANGHAI_OFFSET_MS);
  let target = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), h, m, 0) - SHANGHAI_OFFSET_MS;
  if (target <= now) target += 24 * 3600 * 1000;
  return target - now;
}

class SnapshotMode {
  constructor(env, address, flags) {
    this.env = env; this.address = address; this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
    this.at = pickAt(flags.at, undefined); // 非法 --at 回退默认 20:00
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.label = flags.label ?? null;
    this.seenPositionIds = new Set();
    this.baselineLogged = false;
    this.lastPositions = [];
    this.timer = null;
    this.running = false;
  }

  makeDisplayId() { return this.label ?? shortAddress(this.address); }

  async start() {
    await this.fetchAndReport("启动快照");
    this.scheduleDaily();
    process.on("SIGUSR1", () => this.fetchAndReport("按需快照"));
    if (process.stdin.isTTY) { process.stdin.setEncoding("utf8"); process.stdin.on("data", () => this.fetchAndReport("按需快照")); log(`按需抓取：终端回车，或 kill -USR1 ${process.pid}`); }
    else log(`按需抓取：kill -USR1 ${process.pid}`);
  }

  scheduleDaily() { const ms = msUntilNextShanghai(this.at); this.timer = setTimeout(async () => { await this.fetchAndReport(`每日快照 ${this.at}`); this.scheduleDaily(); }, ms); log(`下次每日抓取：${this.at} 上海时间（约 ${Math.round(ms / 60000)} 分钟后）`); }

  async fetchSnapshot() {
    const stateJson = await httpGetJson(`${this.env.gateway}/api/v1/perps/accounts/${this.address}/state`);
    const data = stateJson?.data ?? stateJson ?? {};
    const positions = Array.isArray(data.P) ? data.P.map(parseWsPosition) : [];
    const ordersRaw = Array.isArray(data.O) ? data.O : [];
    let accountId = this.accountId ?? data.aid ?? data.accountId ?? data.account_id ?? null;
    if (!accountId) accountId = await resolveAccountIdViaChain(this.env, this.address);
    this.accountId = accountId;
    return { positions, ordersRaw, accountId };
  }

  async fetchAndReport(reason) {
    if (this.running) return;
    this.running = true;
    try {
      const snap = await this.fetchSnapshot();
      if (!snap.accountId) { log("无法解析 accountId，跳过"); return; }
      let result = null;
      try { result = await fetchPositionHistory(this.env, snap.accountId); }
      catch (err) {
        log(`[平仓历史拉取失败] ${err.message}`);
        // 快照模式低频（定时/按需），限流时直接跳过本次，等下次触发
        if (THROTTLE_STATUSES.has(err.status)) log(`触发限流(${err.status})，跳过本次快照`);
      }
      // 拉取失败：不渲染空数据
      if (result === null) { log("拉取失败，跳过本次快照上报"); return; }

      const records = result.records ?? [];
      const reduceOnly = parseReduceOnlyOrders(snap.ordersRaw);
      const newPosIds = new Set();
      for (const r of records) { if (!this.seenPositionIds.has(r.positionId)) { this.seenPositionIds.add(r.positionId); if (this.baselineLogged) newPosIds.add(r.positionId); } }
      if (this.seenPositionIds.size > SEEN_IDS_CAP) this.seenPositionIds = new Set(records.map((r) => r.positionId));
      this.baselineLogged = true;
      this.lastPositions = snap.positions;
      const clock = fmtTime();
      const displayId = this.makeDisplayId();

      console.log("\n" + buildEventBanner(displayId, "SNAPSHOT", clock));
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(snap.positions, reduceOnly));
      const histText = renderPositionHistory(records, newPosIds, this.historyLimit);
      console.log("\n--- 平仓历史 Position History ---"); console.log(histText ?? "  （无平仓记录）");
      if (this.flags.raw && result?.raw) { console.log("\n--- raw positions ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const tgText = buildTgMessage(displayId, "SNAPSHOT", clock, snap.positions, reduceOnly, records, newPosIds, this.historyLimit);
      sendTelegram(this.tgToken, this.tgChat, tgText);
    } catch (e) { log(`快照失败：${e.message}`); }
    finally { this.running = false; }
  }

  close() { if (this.timer) clearTimeout(this.timer); }
}

// ---------- 配置文件（多地址）----------
// G8：缺失 / 解析失败 / watches 空 → exit(1)；非法 address 跳过告警；重复 address 去重保首个。
function loadConfig(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { console.error(`配置文件读取失败：${path}（${e.message}）`); process.exit(1); }
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) { console.error(`配置文件 JSON 解析失败：${e.message}`); process.exit(1); }
  const watches = Array.isArray(cfg.watches) ? cfg.watches : [];
  if (!watches.length) { console.error("配置文件 watches 为空"); process.exit(1); }
  const seen = new Set();
  const valid = [];
  for (const w of watches) {
    if (!w || !isAddress(w.address)) { console.error(`跳过非法 address：${w?.address}`); continue; }
    const key = w.address.toLowerCase();
    if (seen.has(key)) { console.error(`跳过重复 address：${w.address}`); continue; }
    if (w.at !== undefined && !isValidHHMM(w.at)) console.error(`地址 ${w.address} 的 at="${w.at}" 非法（应为 HH:MM），回退默认 20:00`);
    seen.add(key);
    valid.push(w);
  }
  if (!valid.length) { console.error("配置文件无有效 address"); process.exit(1); }
  return { tgToken: cfg.tgToken ?? null, watches: valid };
}

// ---------- 入口 ----------
async function main() {
  const { address, flags } = parseArgs(process.argv.slice(2));
  const configPath = typeof flags.config === "string" ? flags.config : null;
  const snapshotMode = flags.snapshot === true || flags.snapshot === "true";

  // G7：--config 仅实时 WS 模式，与 --snapshot 互斥（多地址快照本次不做）
  if (configPath && snapshotMode) { console.error("--config 与 --snapshot 互斥（多地址快照本次不做）"); process.exit(1); }

  const env = ENVS[flags.env ?? "production"];
  if (!env) { console.error(`未知 env: ${flags.env}`); process.exit(1); }

  // 多地址模式：读 config，循环建 N 个 watcher
  if (configPath) {
    const cfg = loadConfig(configPath);
    await refreshSymbols(env).catch((e) => log(`符号列表拉取失败（不阻断）：${e.message}`));
    setInterval(() => refreshSymbols(env).catch(() => {}), SYMBOLS_REFRESH_MS);
    const runners = cfg.watches.map((w) => new AccountWatcher(env, w.address, {
      ...flags,
      "tg-token": w.tgToken ?? cfg.tgToken,
      "tg-chat": w.tgChat ?? null,
      label: w.label ?? null,
      at: pickAt(w.at, flags.at), // 每地址独立镜像时刻：地址项 at > 全局 --at > 默认 20:00
    }));
    log(`模式：多地址实时 WS（${runners.length} 个地址，共享限流）`);
    for (const r of runners) r.start();
    process.on("SIGINT", () => { log("收到 SIGINT，关闭全部"); for (const r of runners) r.close(); process.exit(0); });
    return;
  }

  // 单地址模式（向后兼容）
  if (!isAddress(address)) {
    console.error("用法: node script/watch-account.mjs 0xAddress [模式] [选项]\n" +
      "  多地址：node script/watch-account.mjs --config=script/watch.config.json\n" +
      "  默认实时 WS + 每日 20:00 快照；--snapshot 纯快照模式\n" +
      "  --at=HH:MM  每日快照时间（上海，默认 20:00）\n" +
      "  Telegram：--tg-token=BOT_TOKEN --tg-chat=CHAT_ID\n" +
      "  通用：--history-limit=N（平仓历史条数，默认 2）/ --account-id=N / --raw\n" +
      "  实时模式额外：--debounce-ms=N（默认 3000）/ --max-wait-ms=N（默认 5000，防抖封顶）");
    process.exit(1);
  }

  await refreshSymbols(env).catch((e) => log(`符号列表拉取失败（不阻断）：${e.message}`));
  setInterval(() => refreshSymbols(env).catch(() => {}), SYMBOLS_REFRESH_MS);

  const runner = snapshotMode ? new SnapshotMode(env, address, flags) : new AccountWatcher(env, address, flags);
  log(snapshotMode ? "模式：snapshot（按需 + 每日定时）" : "模式：实时 WS 监听");
  runner.start();

  process.on("SIGINT", () => { log("收到 SIGINT，关闭"); runner.close(); process.exit(0); });
}

// 仅作为入口直接运行时启动；被 import（如单测）时不触发 WS/副作用
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error("启动失败:", err); process.exit(1); });
}
