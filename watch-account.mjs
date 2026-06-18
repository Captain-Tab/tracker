#!/usr/bin/env node
// 监听某钱包 address 的 perps 账户变化（事件驱动，非轮询）。
// 当前持仓直接取自 WS accountState 快照；成交历史在变化时用 REST 拉取。
//
// 零依赖（Node 22 内置 WebSocket + fetch）、无 SDK、无鉴权。
// Node < 22 自动 polyfill ws 包（npm install ws）。
//
// 请求控制（防 429/409 限流、防多发/漏发）：
//   1. 指纹去重 — 规范化比对（abs(size)+派生方向+排序），消除表示/顺序漂移误判
//   2. 防抖合并 — 默认 3000ms + maxWait 5000ms 封顶，活跃流不饥饿
//   3. 限流退避 — 429/409 优先 Retry-After，否则指数 2→60s + jitter；冷却后单次补拉；限流不打备路
//   4. 失败兜底 — 拉取失败不渲染空数据，保留指纹待下次成功（不误报）
//   5. 暂缓重试 — accountState/accountTrade 异步时等 2s 补拉
//
// 用法：
//   node watch-account.mjs 0xYourAddress
//   node watch-account.mjs 0xYourAddress --snapshot
//   node watch-account.mjs 0xYourAddress --tg-token=BOT_TOKEN --tg-chat=CHAT_ID

// Node < 22 WebSocket polyfill
if (typeof WebSocket === "undefined") {
  try {
    const WS = (await import("ws")).default || (await import("ws")).WebSocket;
    const WSBase = WS.prototype ? WS : WS.WebSocket;
    globalThis.WebSocket = function (url, protocols) {
      return new WSBase(url, protocols, { handshakeTimeout: 10000, headers: { "User-Agent": "node" } });
    };
  } catch {
    console.error("Node < 22 需要安装 ws 包:\n  npm install ws");
    process.exit(1);
  }
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
const SIDE_MAP = { 1: "Buy", 2: "Sell" };

// 429/409 同属限流家族（409 为本网关实测限流码，非标准 Conflict 语义）
const THROTTLE_STATUSES = new Set([429, 409]);

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SYMBOLS_REFRESH_MS = 6 * 60 * 60 * 1_000;
const TG_TIMEOUT_MS = 8_000;

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

// 构建 Telegram 消息（样式 F 卡片）
function buildTgMessage(clock, events, newFills, positions, markByCoin, trades, newKeys, pnlMap, reason) {
  const lines = [];
  const isEvent = reason !== "daily" && reason !== "snapshot";
  const SEP = "━━━━━━━━━━━━━━━━";

  // 1) banner
  if (newFills.length > 0) {
    let label = "NEW FILL";
    if (events.length > 0) {
      const ev = events.map((e) => e.split(" ")[0]);
      label = ev.includes("CLOSED") ? "CLOSE FILL" : ev.includes("OPENED") ? "OPEN FILL" : "NEW FILL";
    } else {
      const pm2 = pnlMap ?? computeRealizedPnl(trades);
      label = newFills.some((t) => { const v = pm2.get(tradeKey(t)); return v !== null && v !== undefined; }) ? "CLOSE FILL" : "OPEN FILL";
    }
    lines.push(`⚡ ${label}${newFills.length > 1 ? "S (" + newFills.length + ")" : ""} · ${clock}`);
  } else if (events.length) {
    lines.push(`⚡ POSITION CHANGE · ${clock}`);
    for (const e of events) lines.push(e);
  } else if (!isEvent) {
    lines.push(`${reason === "snapshot" ? "📅 快照" : "📅 每日快照"} · ${clock}`);
  } else {
    lines.push(`⚡ UPDATE: ${clock}`);
  }

  // 2) 仓位卡片
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (open.length) {
    for (const p of open) {
      const coin = baseCoin(p.symbol);
      const dir = positionDirection(p);
      const absSize = Math.abs(Number(p.size));
      const lev = p.leverage || 0;
      const mark = markByCoin?.get(coin) ?? null;
      const entry = Number(p.entry);
      const uPnl = Number(p.unrealizedPnl);
      const margin = lev > 0 ? (absSize * entry) / lev : null;
      const pnlSign = uPnl >= 0 ? "+" : "";
      const roe = margin && margin > 0 ? ` (${(uPnl / margin * 100) >= 0 ? "+" : ""}${(uPnl / margin * 100).toFixed(2)}%)` : "";
      lines.push(`\n${SEP}`);
      lines.push(`📊 仓位：${coin} ${lev}x ${dir}`);
      lines.push(`  持仓量  ${fmt(absSize, 2)}`);
      lines.push(`  开仓价  ${fmt(p.entry, 2)}`);
      lines.push(`  标记价  ${mark !== null ? fmt(mark, 2) : "-"}`);
      lines.push(`  未结盈亏  ${pnlSign}$${Math.abs(uPnl).toFixed(2)}${roe}`);
      lines.push(`  强平价  ${fmt(p.liqPrice, 2)}`);
      if (margin !== null) lines.push(`  保证金  $${margin.toFixed(2)} (${marginModeLabel(p.marginMode)})`);
      lines.push(`${SEP}`);
    }
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }

  // 3) 成交卡片
  if (trades.length) {
    const pm = pnlMap ?? computeRealizedPnl(trades);
    lines.push(`\n📜 成交历史 (最近${trades.length}条)\n`);
    for (const t of trades.slice(0, 20)) {
      const m = symbolMeta(t.symbol_id);
      const dt = t.ts_ms ? new Date(Number(t.ts_ms)).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }) : "-";
      const marker = newKeys.has(tradeKey(t)) ? "★" : " ";
      const dir2 = SIDE_MAP[t.side] ?? String(t.side);
      const pnl = pm.get(tradeKey(t));
      const pnlStr = pnl === null || pnl === undefined ? "—" : `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`;
      const tradeValue = Number(t.price) * Number(t.quantity);
      lines.push(`${marker} ${dt}`);
      lines.push(`  ${m.name} ${dir2} ${fmt(t.quantity, 2)} @${fmt(t.price, 2)} Value $${fmt(tradeValue, 2)}`);
      lines.push(`  盈亏 ${pnlStr}  手续费 ${fmt(t.fee, 2)} ${m.quoteCoin}`);
      lines.push("");
    }
    if (trades.length > 20) lines.push(`... 共 ${trades.length} 条`);
  }

  return lines.join("\n");
}

// ---------- 符号元数据缓存 ----------
let symbolsById = new Map();

async function refreshSymbols(env) {
  const json = await httpGetJson(`${env.biz}/biz/futures/symbols?env=${env.bizEnv}`);
  const list = Array.isArray(json?.data) ? json.data : [];
  const map = new Map();
  for (const s of list) map.set(Number(s.id), { name: `${s.baseCoin}/${s.quoteCoin}`, quoteCoin: s.quoteCoin });
  if (map.size) { symbolsById = map; log(`符号缓存已更新：${map.size} 个 perps 交易对`); }
  else log("符号列表为空，沿用旧缓存");
}

function symbolMeta(symbolId) {
  return symbolsById.get(Number(symbolId)) ?? { name: `#${symbolId}`, quoteCoin: "" };
}

// ---------- WS 快照仓位解析 ----------
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

async function resolveAccountIdViaChain(env, address) {
  const resp = await httpGetJson(`${env.chain}/chain/address/${address}/accounts`).catch(() => null);
  if (resp?.code !== 0 || !resp?.data) return null;
  return resp.data.primaryAccountId ?? null;
}

const ALL_PAGE_SIZE = 100;
const ALL_MAX_PAGES = 200;

async function fetchTradesNext(env, accountId, opts) {
  const base = `${env.data}/api/v1/perps/trades?account_id=${encodeURIComponent(accountId)}`;
  if (!opts.all) {
    const json = await httpGetJson(`${base}&limit=${opts.limit}`);
    return { source: "sodex-next", trades: json?.data ?? [], raw: json };
  }
  const trades = [];
  let cursor = "", pages = 0;
  while (pages < ALL_MAX_PAGES) {
    const url = `${base}&limit=${ALL_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const json = await httpGetJson(url);
    const batch = json?.data ?? [];
    trades.push(...batch);
    cursor = json?.meta?.next_cursor ?? "";
    pages++;
    if (!cursor || batch.length === 0) break;
  }
  if (pages >= ALL_MAX_PAGES && cursor) log(`已达翻页上限 ${ALL_MAX_PAGES} 页，结果可能不完整`);
  return { source: "sodex-next", trades, raw: { pages, count: trades.length } };
}

async function fetchTradesWeb(env, accountId, opts) {
  const pageSize = opts.all ? 1000 : opts.limit;
  const json = await httpGetJson(`${env.gateway}/futures/fapi/trade/v1/order/trade-list?accountId=${encodeURIComponent(accountId)}&pageSize=${pageSize}`);
  const rows = json?.data?.rows ?? json?.data ?? [];
  return { source: "sodex-web", trades: Array.isArray(rows) ? rows : [], raw: json };
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

const fmt = (n, dp) => { const x = Number(n); return Number.isFinite(x) ? x.toFixed(dp) : String(n); };

function renderPositions(positions, markByCoin) {
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (!open.length) return "  （无持仓）";
  const header = ["Coin", "Amount", "Position Value", "Entry", "Mark", "Unrealized PnL (ROE%)", "Liq.Price", "Margin"];
  const rows = open.map((p) => {
    const coin = baseCoin(p.symbol);
    const dir = positionDirection(p);
    const absSize = Math.abs(Number(p.size));
    const lev = p.leverage || 0;
    const mark = markByCoin?.get(coin) ?? null;
    const entry = Number(p.entry);
    const uPnl = Number(p.unrealizedPnl);
    const margin = lev > 0 ? (absSize * entry) / lev : null;
    const posValue = absSize * (mark ?? entry);
    const roe = margin && margin > 0 ? (uPnl / margin) * 100 : null;
    const pnlStr = `${uPnl < 0 ? "-" : ""}$${Math.abs(uPnl).toFixed(2)}` + (roe !== null ? ` (${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%)` : "");
    return [`${coin} ${lev}x ${dir}`, `${fmt(absSize, 2)} ${coin}`, `${posValue.toFixed(2)} USDC`, fmt(p.entry, 2), mark !== null ? fmt(mark, 2) : "-", pnlStr, fmt(p.liqPrice, 2), margin !== null ? `$${margin.toFixed(2)} (${marginModeLabel(p.marginMode)})` : "-"];
  });
  const w = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

const tradeKey = (t) => String(t.trade_id ?? `${t.ts_ms}-${t.price}-${t.quantity}`);

function computeRealizedPnl(trades) {
  const asc = [...trades].sort((a, b) => Number(a.ts_ms) - Number(b.ts_ms));
  const state = new Map();
  const out = new Map();
  for (const t of asc) {
    const price = Number(t.price);
    const qty = Number(t.quantity);
    const key = tradeKey(t);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || (t.side !== 1 && t.side !== 2)) { out.set(key, null); continue; }
    const signed = (t.side === 1 ? 1 : -1) * qty;
    const s = state.get(t.symbol_id) ?? { qty: 0, entry: 0 };
    let pnl = null;
    if (s.qty === 0 || Math.sign(s.qty) === Math.sign(signed)) {
      const absNew = Math.abs(s.qty) + qty;
      s.entry = absNew > 0 ? (s.entry * Math.abs(s.qty) + price * qty) / absNew : price;
      s.qty += signed;
    } else {
      const closeQty = Math.min(qty, Math.abs(s.qty));
      const dirSign = Math.sign(s.qty);
      pnl = (price - s.entry) * closeQty * dirSign;
      s.qty += signed;
      if (s.qty === 0) s.entry = 0;
      else if (Math.sign(s.qty) !== dirSign) s.entry = price;
    }
    state.set(t.symbol_id, s);
    out.set(key, pnl);
  }
  return out;
}

function renderTrades(trades, newKeys = new Set()) {
  if (!trades.length) return "  （无成交记录）";
  const pnlMap = computeRealizedPnl(trades);
  const header = ["Time", "Coin", "Direction", "Price", "Amount", "Trade Value", "Realized PnL", "Fee"];
  const rows = trades.map((t) => {
    const m = symbolMeta(t.symbol_id);
    const clock = t.ts_ms ? new Date(Number(t.ts_ms)).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }) : "-";
    const time = `${newKeys.has(tradeKey(t)) ? "★ " : "  "}${clock}`;
    const dir = SIDE_MAP[t.side] ?? String(t.side);
    const price = fmt(t.price, 2);
    const value = `$${fmt(Number(t.price) * Number(t.quantity), 2)}`;
    const pnl = pnlMap.get(tradeKey(t));
    const pnlStr = pnl === null || pnl === undefined ? "-" : `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`;
    const fee = `${fmt(t.fee, 2)} ${m.quoteCoin}`.trim();
    return [time, m.name, dir, price, fmt(t.quantity, 2), value, pnlStr, fee];
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

function buildEventBanner(clock, newFills, positions, events) {
  const openByCoin = new Map(positions.filter((p) => Number(p.size) !== 0).map((p) => [baseCoin(p.symbol), p]));
  const resultOf = (coin) => { const p = openByCoin.get(coin); return p ? `${positionDirection(p)} ${fmt(Math.abs(Number(p.size)), 2)}` : "FLAT (closed)"; };
  if (newFills.length === 1) {
    const t = newFills[0];
    const coin = baseCoin(symbolMeta(t.symbol_id).name);
    return boxBanner([`⚡ NEW FILL  ·  ${clock}`, `   ${SIDE_MAP[t.side] ?? t.side} ${fmt(t.quantity, 2)} ${coin} @ ${fmt(t.price, 2)}  →  ${resultOf(coin)}`]);
  }
  if (newFills.length > 1) {
    const coins = [...new Set(newFills.map((t) => baseCoin(symbolMeta(t.symbol_id).name)))];
    return boxBanner([`⚡ NEW FILLS (${newFills.length})  ·  ${clock}`, ...newFills.map((t) => `   ${SIDE_MAP[t.side] ?? t.side} ${fmt(t.quantity, 2)} ${baseCoin(symbolMeta(t.symbol_id).name)} @ ${fmt(t.price, 2)}`), ...coins.map((coin) => `   →  ${coin} ${resultOf(coin)}`)]);
  }
  if (events.length) return boxBanner([`⚡ POSITION CHANGE  ·  ${clock}`, ...events.map((e) => `   ${e}`)]);
  return boxBanner([`⚡ ACCOUNT UPDATE  ·  ${clock}`, `   (no net position change)`]);
}

// ---------- 监听器 ----------
class AccountWatcher {
  constructor(env, address, flags) {
    this.env = env;
    this.address = address;
    this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 5);
    this.fetchAll = flags.all === true || flags.all === "true";
    this.debounceMs = Number(flags["debounce-ms"] ?? 3000);
    this.maxWaitMs = Number(flags["max-wait-ms"] ?? 5000);
    this.enableWebFallback = flags["enable-web-fallback"] === true || flags["enable-web-fallback"] === "true";
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.at = String(flags.at ?? "20:00");
    this.forceReport = false;
    this.dailyTimer = null;
    this.tgReason = "event";
    this.rateLimitUntil = 0;
    this.rateLimitBackoff = 0;
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
    this.markByCoin = new Map();
    this.lastPositions = [];
    this.seenTradeIds = new Set();
    this.baselineLogged = false;
    this.stateFp = null;
    this.lastOutFp = null;
  }

  start() { this.connect(); }

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
      if (Array.isArray(data.B)) { const m = new Map(); for (const b of data.B) if (b?.a != null && b?.px != null) m.set(String(b.a), Number(b.px)); this.markByCoin = m; }
      // 触发指纹只认规范化后的仓位身份；移除订单数组（易变字段每秒翻指纹→过度拉取，
      // 且报告不展示挂单，无新成交则无可报）。新成交另由 accountTrade 触发。
      const fp = canonicalPositionsFp(this.positions);
      if (fp !== this.stateFp) { this.stateFp = fp; this.scheduleFetch(); }
      return;
    }
    if (msg.channel === "accountTrade") this.scheduleFetch();
  }

  scheduleFetch() {
    if (Date.now() < this.rateLimitUntil) return;
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

  // 限流退避（秒级翻倍封顶 60s）+ ±20% jitter，防多实例同步重试惊群
  nextBackoffMs() {
    this.rateLimitBackoff = Math.min((this.rateLimitBackoff || 1) * 2, 60);
    const base = this.rateLimitBackoff * 1000;
    return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
  }

  async fetchAndReport() {
    if (this.fetching) { this.scheduleFetch(); return; }
    // 冷却兜底：限流前已 armed 的 debounceTimer 可能在冷却期内 fire，
    // 此处再 gate 一次，避免在 rateLimitUntil 内打出请求又触发限流。
    if (Date.now() < this.rateLimitUntil) return;
    this.fetching = true;
    try {
      if (!this.accountId) { this.accountId = await resolveAccountIdViaChain(this.env, this.address); if (!this.accountId) { log("无法解析 accountId，跳过"); return; } log(`accountId = ${this.accountId}（来自 chain api）`); }
      const fetchOpts = this.fetchAll ? { all: true } : { limit: this.historyLimit };
      let result = null;
      try {
        result = await fetchTradesNext(this.env, this.accountId, fetchOpts);
        this.rateLimitBackoff = 0;
      } catch (err) {
        log(`[next 主路失败] ${err.message}`);
        if (THROTTLE_STATUSES.has(err.status)) {
          // 限流：优先用服务端 Retry-After，否则指数退避 + jitter；gate 所有请求；
          // 不打 web 备路（两 host 可能共限，转移只会双限）；冷却后单次 catch-up。
          const waitMs = err.retryAfterMs ?? this.nextBackoffMs();
          this.rateLimitUntil = Date.now() + waitMs;
          log(`触发限流(${err.status})，${Math.round(waitMs / 1000)}s 后恢复`);
          setTimeout(() => this.scheduleFetch(), waitMs + 500);
        } else if (this.enableWebFallback) {
          result = await fetchTradesWeb(this.env, this.accountId, fetchOpts).catch((e) => { log(`[web 备路失败] ${e.message}`); return null; });
        }
      }
      // 拉取失败（限流/硬错误未降级成功）：不渲染空数据，保留 lastOutFp / forceReport 待下次成功
      if (result === null) return;
      const trades = result.trades ?? [];
      const tradeFp = trades.map(tradeKey).sort().join(",");
      const outFp = canonicalPositionsFp(this.positions) + "|" + tradeFp;
      const force = this.forceReport; this.forceReport = false;
      if (!force && outFp === this.lastOutFp) return;
      this.lastOutFp = outFp;

      const events = diffPositions(this.lastPositions, this.positions);
      this.lastPositions = this.positions;

      const newKeys = new Set();
      for (const t of trades) { const k = tradeKey(t); if (!this.seenTradeIds.has(k)) { this.seenTradeIds.add(k); if (this.baselineLogged) newKeys.add(k); } }
      const isBaseline = !this.baselineLogged;
      this.baselineLogged = true;
      const newFills = trades.filter((t) => newKeys.has(tradeKey(t)));

      if (!force && !isBaseline && events.length > 0 && newFills.length === 0) {
        if (!this.retryScheduled) { this.retryScheduled = true; this.lastOutFp = null; setTimeout(() => { this.retryScheduled = false; this.scheduleFetch(); }, 2000); }
        return;
      }
      this.retryScheduled = false;

      const clock = ts();
      console.log(""); console.log(buildEventBanner(clock, newFills, this.positions, events)); log(`account_id=${this.accountId}`);
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(this.positions, this.markByCoin));
      console.log("\n--- 成交历史 Trade History ---"); console.log(renderTrades(trades, newKeys));
      if (this.flags.raw && result?.raw) { console.log("\n--- raw trades ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const tgPnlMap = computeRealizedPnl(trades);
      const shClock = nowShanghai();
      const tgText = buildTgMessage(shClock, events, newFills, this.positions, this.markByCoin, trades, newKeys, tgPnlMap, this.tgReason);
      this.tgReason = "event";
      sendTelegram(this.tgToken, this.tgChat, tgText);
    } finally { this.fetching = false; }
  }

  close() { this.closing = true; this.clearTimers(); try { this.ws?.close(); } catch {} }
}

// ---------- Snapshot 模式 ----------
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function msUntilNextShanghai(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const now = Date.now();
  const sh = new Date(now + SHANGHAI_OFFSET_MS);
  let target = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), h, m, 0) - SHANGHAI_OFFSET_MS;
  if (target <= now) target += 24 * 3600 * 1000;
  return target - now;
}

const nowShanghai = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });

class SnapshotMode {
  constructor(env, address, flags) {
    this.env = env; this.address = address; this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 5);
    this.fetchAll = flags.all === true || flags.all === "true";
    this.at = String(flags.at ?? "20:00");
    this.enableWebFallback = flags["enable-web-fallback"] === true || flags["enable-web-fallback"] === "true";
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.seenTradeIds = new Set();
    this.baselineLogged = false;
    this.lastPositions = [];
    this.timer = null;
    this.running = false;
  }

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
    const markByCoin = new Map();
    if (Array.isArray(data.B)) for (const b of data.B) if (b?.a != null && b?.px != null) markByCoin.set(String(b.a), Number(b.px));
    let accountId = this.accountId ?? data.aid ?? data.accountId ?? data.account_id ?? null;
    if (!accountId) accountId = await resolveAccountIdViaChain(this.env, this.address);
    this.accountId = accountId;
    return { positions, markByCoin, accountId };
  }

  async fetchAndReport(reason) {
    if (this.running) return;
    this.running = true;
    try {
      const snap = await this.fetchSnapshot();
      if (!snap.accountId) { log("无法解析 accountId，跳过"); return; }
      const fetchOpts = this.fetchAll ? { all: true } : { limit: this.historyLimit };
      let result = null;
      try { result = await fetchTradesNext(this.env, snap.accountId, fetchOpts); }
      catch (err) {
        log(`[next 主路失败] ${err.message}`);
        // 快照模式低频（定时/按需），限流时直接跳过本次，等下次触发；不打备路
        if (THROTTLE_STATUSES.has(err.status)) log(`触发限流(${err.status})，跳过本次快照`);
        else if (this.enableWebFallback) result = await fetchTradesWeb(this.env, snap.accountId, fetchOpts).catch((e) => { log(`[web 备路失败] ${e.message}`); return null; });
      }
      // 拉取失败：不渲染空数据
      if (result === null) { log("拉取失败，跳过本次快照上报"); return; }
      const trades = result.trades ?? [];

      const newKeys = new Set();
      for (const t of trades) { const k = tradeKey(t); if (!this.seenTradeIds.has(k)) { this.seenTradeIds.add(k); if (this.baselineLogged) newKeys.add(k); } }
      this.baselineLogged = true;
      const events = diffPositions(this.lastPositions, snap.positions);
      this.lastPositions = snap.positions;

      console.log("\n" + boxBanner([`⚡ SNAPSHOT · ${reason}`, `   ${nowShanghai()} (UTC+8) · account_id=${snap.accountId}`, ...events.map((e) => `   ${e}`)]));
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(snap.positions, snap.markByCoin));
      console.log("\n--- 成交历史 Trade History ---"); console.log(renderTrades(trades, newKeys));
      if (this.flags.raw && result?.raw) { console.log("\n--- raw trades ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const newFills = trades.filter((t) => newKeys.has(tradeKey(t)));
      const tgPnlMap = computeRealizedPnl(trades);
      const tgText = buildTgMessage(nowShanghai(), events, newFills, snap.positions, snap.markByCoin, trades, newKeys, tgPnlMap, "snapshot");
      sendTelegram(this.tgToken, this.tgChat, tgText);
    } catch (e) { log(`快照失败：${e.message}`); }
    finally { this.running = false; }
  }

  close() { if (this.timer) clearTimeout(this.timer); }
}

// ---------- 入口 ----------
async function main() {
  const { address, flags } = parseArgs(process.argv.slice(2));
  if (!isAddress(address)) {
    console.error("用法: node watch-account.mjs 0xAddress [模式] [选项]\n" +
      "  默认实时 WS + 每日 20:00 快照；--snapshot 纯快照模式\n" +
      "  --at=HH:MM  每日快照时间（上海，默认 20:00）\n" +
      "  Telegram：--tg-token=BOT_TOKEN --tg-chat=CHAT_ID\n" +
      "  通用：--all / --history-limit=N（默认 5）/ --enable-web-fallback / --account-id=N / --raw\n" +
      "  实时模式额外：--debounce-ms=N（默认 3000）/ --max-wait-ms=N（默认 5000，防抖封顶）");
    process.exit(1);
  }
  const env = ENVS[flags.env ?? "production"];
  if (!env) { console.error(`未知 env: ${flags.env}`); process.exit(1); }

  await refreshSymbols(env).catch((e) => log(`符号列表拉取失败（不阻断）：${e.message}`));
  setInterval(() => refreshSymbols(env).catch(() => {}), SYMBOLS_REFRESH_MS);

  const snapshotMode = flags.snapshot === true || flags.snapshot === "true";
  const runner = snapshotMode ? new SnapshotMode(env, address, flags) : new AccountWatcher(env, address, flags);
  log(snapshotMode ? "模式：snapshot（按需 + 每日定时）" : "模式：实时 WS 监听");
  runner.start();

  process.on("SIGINT", () => { log("收到 SIGINT，关闭"); runner.close(); process.exit(0); });
}

main().catch((err) => { console.error("启动失败:", err); process.exit(1); });
