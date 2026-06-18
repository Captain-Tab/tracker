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

// 构建 Telegram 消息（样式 F 卡片）。banner 头带【accountId】动词化;仓位走 derivePositionView 统一口径
function buildTgMessage(accountId, kind, clock, newFills, events, positions, trades, newKeys, pnlMap, n) {
  const lines = [];
  const SEP = "━━━━━━━━━━━━━━━━";

  // 1) banner 头 + 明细
  lines.push(bannerHead(accountId, kind, clock, n));
  for (const d of bannerDetailLines(newFills, events, positions)) lines.push(`  ${d}`);

  // 2) 仓位卡片
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
      const marker = newKeys.has(tradeKey(t)) ? "★" : " ";
      const dir2 = SIDE_MAP[t.side] ?? String(t.side);
      const pnl = pm.get(tradeKey(t));
      const pnlStr = pnl === null || pnl === undefined ? "—" : fmtUsd(pnl, true);
      const tradeValue = Number(t.price) * Number(t.quantity);
      lines.push(`${marker} ${fmtTime(t.ts_ms)}`);
      lines.push(`  ${m.name} ${dir2} ${fmtNum(t.quantity, m.quantityPrecision)} @${fmtNum(t.price, m.pricePrecision)} Value ${fmtUsd(tradeValue)}`);
      lines.push(`  盈亏 ${pnlStr}  手续费 ${fmtNum(t.fee, m.feePrecision)} ${m.quoteCoin}`);
      lines.push("");
    }
    if (trades.length > 20) lines.push(`... 共 ${trades.length} 条`);
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

// banner 文案：动词化仓位状态，全部带【accountId】
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

function bannerHead(accountId, kind, clock, n) {
  const label = BANNER_LABEL[kind] ?? "POSITION CHANGE";
  const cnt = kind === "UPDATE" && n ? ` (${n})` : "";
  return `⚡ 【${accountId}】 ${label}${cnt} · ${clock}`;
}

// 由 newFills + events 判定 banner 类型（START / SNAPSHOT 由调用方按 baseline/reason 决定）
function classifyBanner(newFills, events) {
  if (newFills.length > 1) return { kind: "UPDATE", n: newFills.length };
  if (newFills.length === 1) {
    const verbs = events.map((e) => e.split(" ")[0]);
    if (verbs.includes("CLOSED")) return { kind: "CLOSE" };
    if (verbs.includes("OPENED")) return { kind: "OPEN" };
    if (verbs.includes("INCREASED")) return { kind: "INCREASE" };
    if (verbs.includes("DECREASED")) return { kind: "REDUCE" };
    return { kind: "OPEN" }; // 有成交但无明确 diff（开仓在历史窗口外）→ 视为开仓
  }
  return { kind: "CHANGE" }; // 仓位变化无成交（兜底，带 events 明细）
}

// banner 明细行（成交描述 + 结果仓位 / 或 events 列表），console 与 TG 共用
function bannerDetailLines(newFills, events, positions) {
  const openByCoin = new Map(
    positions.filter((p) => Number(p.size) !== 0).map((p) => [baseCoin(p.symbol), p]),
  );
  const resultOf = (coin) => {
    const p = openByCoin.get(coin);
    return p ? `${directionCN(positionDirection(p))} ${fmtNum(Math.abs(Number(p.size)), 6)}` : "已平仓";
  };
  if (newFills.length >= 1) {
    const fills = newFills.map((t) => {
      const m = symbolMeta(t.symbol_id);
      const coin = m.baseCoin || baseCoin(m.name);
      return `${SIDE_MAP[t.side] ?? t.side} ${fmtNum(t.quantity, m.quantityPrecision)} ${coin} @ ${fmtNum(t.price, m.pricePrecision)}`;
    });
    const coins = [...new Set(newFills.map((t) => { const m = symbolMeta(t.symbol_id); return m.baseCoin || baseCoin(m.name); }))];
    return [...fills, ...coins.map((c) => `→ ${c} ${resultOf(c)}`)];
  }
  return [...events];
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

function renderPositions(positions) {
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (!open.length) return "  （无持仓）";
  const header = ["Coin", "方向", "持仓量", "仓位价值", "Entry", "Mark", "Unrealized PnL (ROE%)", "Liq.Price", "Margin"];
  const rows = open.map((p) => {
    const v = derivePositionView(p);
    const pnlStr = fmtUsd(v.uPnl, true) + (v.roe !== null ? ` (${fmtPct(v.roe)})` : "");
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
    ];
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
    const time = `${newKeys.has(tradeKey(t)) ? "★ " : "  "}${fmtTime(t.ts_ms)}`;
    const dir = SIDE_MAP[t.side] ?? String(t.side);
    const price = fmtNum(t.price, m.pricePrecision);
    const value = fmtUsd(Number(t.price) * Number(t.quantity));
    const pnl = pnlMap.get(tradeKey(t));
    const pnlStr = pnl === null || pnl === undefined ? "-" : fmtUsd(pnl, true);
    const fee = `${fmtNum(t.fee, m.feePrecision)} ${m.quoteCoin}`.trim();
    return [time, m.name, dir, price, fmtNum(t.quantity, m.quantityPrecision), value, pnlStr, fee];
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

function buildEventBanner(accountId, kind, clock, newFills, events, positions, n) {
  const head = bannerHead(accountId, kind, clock, n);
  const detail = bannerDetailLines(newFills, events, positions).map((l) => `   ${l}`);
  return boxBanner([head, ...detail]);
}

// ---------- 监听器 ----------
class AccountWatcher {
  constructor(env, address, flags) {
    this.env = env;
    this.address = address;
    this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
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
      // 标记价由 derivePositionView 从持仓反推（账户快照无合约 mark），不再读 data.B
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

      // banner 类型:首帧→START WATCH;每日 force→SNAPSHOT;否则按成交/仓位 diff 动词化
      const { kind, n } = isBaseline
        ? { kind: "START" }
        : this.tgReason === "daily"
          ? { kind: "SNAPSHOT" }
          : classifyBanner(newFills, events);
      const clock = fmtTime();
      console.log(""); console.log(buildEventBanner(this.accountId, kind, clock, newFills, events, this.positions, n)); log(`account_id=${this.accountId}`);
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(this.positions));
      console.log("\n--- 成交历史 Trade History ---"); console.log(renderTrades(trades, newKeys));
      if (this.flags.raw && result?.raw) { console.log("\n--- raw trades ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const tgPnlMap = computeRealizedPnl(trades);
      const tgText = buildTgMessage(this.accountId, kind, clock, newFills, events, this.positions, trades, newKeys, tgPnlMap, n);
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

class SnapshotMode {
  constructor(env, address, flags) {
    this.env = env; this.address = address; this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
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
    let accountId = this.accountId ?? data.aid ?? data.accountId ?? data.account_id ?? null;
    if (!accountId) accountId = await resolveAccountIdViaChain(this.env, this.address);
    this.accountId = accountId;
    return { positions, accountId };
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
      const newFills = trades.filter((t) => newKeys.has(tradeKey(t)));
      const clock = fmtTime();

      console.log("\n" + buildEventBanner(snap.accountId, "SNAPSHOT", clock, newFills, events, snap.positions));
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(snap.positions));
      console.log("\n--- 成交历史 Trade History ---"); console.log(renderTrades(trades, newKeys));
      if (this.flags.raw && result?.raw) { console.log("\n--- raw trades ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const tgPnlMap = computeRealizedPnl(trades);
      const tgText = buildTgMessage(snap.accountId, "SNAPSHOT", clock, newFills, events, snap.positions, trades, newKeys, tgPnlMap);
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
      "  通用：--all / --history-limit=N（默认 2）/ --enable-web-fallback / --account-id=N / --raw\n" +
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

// 仅作为入口直接运行时启动；被 import（如单测）时不触发 WS/副作用
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error("启动失败:", err); process.exit(1); });
}
