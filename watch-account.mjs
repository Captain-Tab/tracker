#!/usr/bin/env node
// 监听某钱包 address 的 perps 账户变化（事件驱动，非轮询）。
// 当前持仓直接取自 WS accountState 快照；成交历史在变化时用 REST 拉取。
//
// 零依赖（Node 22 内置 WebSocket + fetch）、无 SDK、无鉴权（WS 与 data host 均 public）。
// 主路 sodex-next；备路 sodex-web 默认关闭，需 --enable-web-fallback。
//
// 用法：
//   node watch-account.mjs 0xYourAddress
//   node watch-account.mjs 0xYourAddress --snapshot
//   node watch-account.mjs 0xYourAddress --tg-token=BOT_TOKEN --tg-chat=CHAT_ID

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

// perps 账户 WS channel（取自 @sodex/sdk PerpsWsClient.subscribeAccountState）
const CHANNELS = ["accountState", "accountUpdate", "accountOrderUpdate", "accountTrade"];

// 成交 side 映射（取自 sodex-next domain/normalize/history.ts:23）
const SIDE_MAP = { 1: "Buy", 2: "Sell" };

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

// 大整数安全解析：16+ 位整数字面量转字符串，避免 Number 丢精度
function parseJsonSafe(text) {
  const guarded = text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(guarded);
}

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), ...a);

async function httpGetJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? parseJsonSafe(text) : null;
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

// ---------- Telegram 推送 ----------
async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    log(`TG 推送失败：${e.message}`);
  }
}

// 构建 Telegram 消息（镜像终端输出，用 HTML 标记）
function buildTgMessage(clock, events, newFills, positions, markByCoin, trades, newKeys) {
  const lines = [];

  // 1) 事件 banner
  const openByCoin = new Map(
    positions.filter((p) => Number(p.size) !== 0).map((p) => [baseCoin(p.symbol), p]),
  );
  const resultOf = (coin) => {
    const p = openByCoin.get(coin);
    return p ? `${positionDirection(p)} ${fmt(Math.abs(Number(p.size)), 2)}` : "FLAT";
  };

  if (newFills.length === 1) {
    const t = newFills[0];
    const coin = baseCoin(symbolMeta(t.symbol_id).name);
    lines.push(`⚡ NEW FILL · ${clock}`);
    lines.push(`${SIDE_MAP[t.side] ?? t.side} ${fmt(t.quantity, 2)} ${coin} @ ${fmt(t.price, 2)} → ${resultOf(coin)}`);
  } else if (newFills.length > 1) {
    lines.push(`⚡ NEW FILLS (${newFills.length}) · ${clock}`);
    for (const t of newFills) {
      const coin = baseCoin(symbolMeta(t.symbol_id).name);
      lines.push(`${SIDE_MAP[t.side] ?? t.side} ${fmt(t.quantity, 2)} ${coin} @ ${fmt(t.price, 2)}`);
    }
    const coins = [...new Set(newFills.map((t) => baseCoin(symbolMeta(t.symbol_id).name)))];
    for (const coin of coins) lines.push(`→ ${coin} ${resultOf(coin)}`);
  } else if (events.length) {
    lines.push(`⚡ POSITION CHANGE · ${clock}`);
    for (const e of events) lines.push(e);
  }

  // 2) 仓位表
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (open.length) {
    lines.push("\n<b>📊 当前仓位</b>");
    for (const p of open) {
      const coin = baseCoin(p.symbol);
      const dir = positionDirection(p);
      const absSize = Math.abs(Number(p.size));
      const lev = p.leverage || 0;
      const mark = markByCoin?.get(coin) ?? null;
      const entry = Number(p.entry);
      const uPnl = Number(p.unrealizedPnl);
      const margin = lev > 0 ? (absSize * entry) / lev : null;
      const roe = margin && margin > 0 ? `(${(uPnl / margin * 100).toFixed(2)}%)` : "";
      const pnlStr = `${uPnl >= 0 ? "+" : "-"}$${Math.abs(uPnl).toFixed(2)} ${roe}`;
      lines.push(
        `<code>${coin}</code> ${lev}x ${dir} | ${fmt(absSize, 2)} | Entry:${fmt(p.entry, 2)} | Mark:${mark !== null ? fmt(mark, 2) : "-"} | U-PnL:${pnlStr} | Liq:${fmt(p.liqPrice, 2)}`,
      );
    }
  } else {
    lines.push("\n<b>📊 当前仓位</b>\n（无持仓）");
  }

  // 3) 成交历史
  if (trades.length) {
    const pnlMap = computeRealizedPnl(trades);
    lines.push(`\n<b>📜 成交历史</b> (最近${Math.min(trades.length, 10)}条)`);
    // 最多展示 10 条到 Telegram
    for (const t of trades.slice(0, 10)) {
      const m = symbolMeta(t.symbol_id);
      const clock2 = t.ts_ms
        ? new Date(Number(t.ts_ms)).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(11, 19)
        : "-";
      const marker = newKeys.has(tradeKey(t)) ? "★" : "";
      const dir2 = SIDE_MAP[t.side] ?? String(t.side);
      const pnl = pnlMap.get(tradeKey(t));
      const pnlStr = pnl === null || pnl === undefined ? "-" : `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`;
      lines.push(`${marker} ${clock2} ${m.name} ${dir2} ${fmt(t.quantity, 2)} @${fmt(t.price, 2)} PnL:${pnlStr} Fee:${fmt(t.fee, 2)}`);
    }
    if (trades.length > 10) lines.push(`... 共 ${trades.length} 条`);
  }

  return lines.join("\n");
}

// ---------- 符号元数据缓存（symbol_id → 名称/精度）----------
let symbolsById = new Map();

async function refreshSymbols(env) {
  const json = await httpGetJson(`${env.biz}/biz/futures/symbols?env=${env.bizEnv}`);
  const list = Array.isArray(json?.data) ? json.data : [];
  const map = new Map();
  for (const s of list) {
    map.set(Number(s.id), {
      name: `${s.baseCoin}/${s.quoteCoin}`,
      quoteCoin: s.quoteCoin,
    });
  }
  if (map.size) {
    symbolsById = map;
    log(`符号缓存已更新：${map.size} 个 perps 交易对`);
  } else log("符号列表为空，沿用旧缓存");
}

function symbolMeta(symbolId) {
  return (
    symbolsById.get(Number(symbolId)) ?? {
      name: `#${symbolId}`,
      quoteCoin: "",
    }
  );
}

// ---------- WS 快照仓位解析（字段取自 @sodex/sdk parsePerpsSnapshotPosition）----------
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

function marginModeLabel(m) {
  if (/cross/i.test(m)) return "Cross";
  if (/iso/i.test(m)) return "Isolated";
  return m || "-";
}

// ---------- address → accountId 备用解析 ----------
async function resolveAccountIdViaChain(env, address) {
  const resp = await httpGetJson(
    `${env.chain}/chain/address/${address}/accounts`,
  ).catch(() => null);
  if (resp?.code !== 0 || !resp?.data) return null;
  return resp.data.primaryAccountId ?? null;
}

const ALL_PAGE_SIZE = 100;
const ALL_MAX_PAGES = 200;

// ---------- 成交历史 REST：主路 next ----------
async function fetchTradesNext(env, accountId, opts) {
  const base = `${env.data}/api/v1/perps/trades?account_id=${encodeURIComponent(accountId)}`;
  if (!opts.all) {
    const json = await httpGetJson(`${base}&limit=${opts.limit}`);
    return { source: "sodex-next", trades: json?.data ?? [], raw: json };
  }
  const trades = [];
  let cursor = "";
  let pages = 0;
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

// ---------- 成交历史 REST：备路 web ----------
async function fetchTradesWeb(env, accountId, opts) {
  const pageSize = opts.all ? 1000 : opts.limit;
  const json = await httpGetJson(
    `${env.gateway}/futures/fapi/trade/v1/order/trade-list?accountId=${encodeURIComponent(accountId)}&pageSize=${pageSize}`,
  );
  const rows = json?.data?.rows ?? json?.data ?? [];
  return { source: "sodex-web", trades: Array.isArray(rows) ? rows : [], raw: json };
}

// ---------- 仓位 diff ----------
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
      events.push(
        `${grew ? "INCREASED" : "DECREASED"} ${dir} ${baseCoin(p.symbol)} ${Math.abs(Number(b.size))}→${amt}`,
      );
    }
  }
  for (const [k, p] of pm)
    if (!cm.has(k)) events.push(`CLOSED ${positionDirection(p)} ${baseCoin(p.symbol)}`);
  return events;
}

// ---------- 渲染 ----------
const fmt = (n, dp) => {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(dp) : String(n);
};

function renderPositions(positions, markByCoin) {
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (!open.length) return "  （无持仓）";
  const header = [
    "Coin",
    "Amount",
    "Position Value",
    "Entry",
    "Mark",
    "Unrealized PnL (ROE%)",
    "Liq.Price",
    "Margin",
  ];
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
    const pnlStr =
      `${uPnl < 0 ? "-" : ""}$${Math.abs(uPnl).toFixed(2)}` +
      (roe !== null ? ` (${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%)` : "");
    return [
      `${coin} ${lev}x ${dir}`,
      `${fmt(absSize, 2)} ${coin}`,
      `${posValue.toFixed(2)} USDC`,
      fmt(p.entry, 2),
      mark !== null ? fmt(mark, 2) : "-",
      pnlStr,
      fmt(p.liqPrice, 2),
      margin !== null ? `$${margin.toFixed(2)} (${marginModeLabel(p.marginMode)})` : "-",
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
    if (!Number.isFinite(price) || !Number.isFinite(qty) || (t.side !== 1 && t.side !== 2)) {
      out.set(key, null);
      continue;
    }
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
    const clock = t.ts_ms
      ? new Date(Number(t.ts_ms)).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
      : "-";
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
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    w += cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) ? 2 : 1;
  }
  return w;
}

function boxBanner(lines) {
  const w = Math.max(...lines.map(displayWidth));
  const bar = "═".repeat(w + 2);
  const body = lines.map((l) => `║ ${l}${" ".repeat(w - displayWidth(l))} ║`);
  return [`╔${bar}╗`, ...body, `╚${bar}╝`].join("\n");
}

function buildEventBanner(clock, newFills, positions, events) {
  const openByCoin = new Map(
    positions.filter((p) => Number(p.size) !== 0).map((p) => [baseCoin(p.symbol), p]),
  );
  const resultOf = (coin) => {
    const p = openByCoin.get(coin);
    return p ? `${positionDirection(p)} ${fmt(Math.abs(Number(p.size)), 2)}` : "FLAT (closed)";
  };
  if (newFills.length === 1) {
    const t = newFills[0];
    const coin = baseCoin(symbolMeta(t.symbol_id).name);
    return boxBanner([
      `⚡ NEW FILL  ·  ${clock}`,
      `   ${SIDE_MAP[t.side] ?? t.side} ${fmt(t.quantity, 2)} ${coin} @ ${fmt(t.price, 2)}  →  ${resultOf(coin)}`,
    ]);
  }
  if (newFills.length > 1) {
    const coins = [...new Set(newFills.map((t) => baseCoin(symbolMeta(t.symbol_id).name)))];
    return boxBanner([
      `⚡ NEW FILLS (${newFills.length})  ·  ${clock}`,
      ...newFills.map((t) => {
        const coin = baseCoin(symbolMeta(t.symbol_id).name);
        return `   ${SIDE_MAP[t.side] ?? t.side} ${fmt(t.quantity, 2)} ${coin} @ ${fmt(t.price, 2)}`;
      }),
      ...coins.map((coin) => `   →  ${coin} ${resultOf(coin)}`),
    ]);
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
    this.historyLimit = Number(flags["history-limit"] ?? 10);
    this.fetchAll = flags.all === true || flags.all === "true";
    this.debounceMs = Number(flags["debounce-ms"] ?? 750);
    this.enableWebFallback =
      flags["enable-web-fallback"] === true || flags["enable-web-fallback"] === "true";
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.ws = null;
    this.requestId = 0;
    this.reconnectAttempt = 0;
    this.pingTimer = null;
    this.pongTimer = null;
    this.debounceTimer = null;
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

  start() {
    this.connect();
  }

  connect() {
    const url = `${this.env.gatewayWs}/ws/perps`;
    log(`连接 ${url}（无鉴权）`);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      log("OPEN，订阅账户频道");
      for (const channel of CHANNELS) {
        this.send({ op: "subscribe", id: ++this.requestId, params: { channel, user: this.address } });
      }
      this.startPing();
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = (ev) => {
      this.clearTimers();
      if (this.closing) return;
      log(`CLOSE code=${ev.code} reason=${ev.reason || "(none)"}，准备重连`);
      this.scheduleReconnect();
    };
    ws.onerror = (ev) => log("WS ERROR:", ev?.message || ev?.type || ev);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  startPing() {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      this.send({ op: "ping" });
      this.pongTimer = setTimeout(() => {
        log("pong 超时，断开重连");
        try {
          this.ws?.close();
        } catch {}
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  scheduleReconnect() {
    const exp = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    const delay = Math.round(exp + exp * 0.2 * (Math.random() * 2 - 1));
    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }

  handleMessage(raw) {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    let msg;
    try {
      msg = parseJsonSafe(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (msg.op === "pong") return;
    if (msg.op === "subscribe" || msg.op === "unsubscribe") {
      if (msg.success === false) log(`订阅失败：${msg.error ?? "unknown"}`);
      return;
    }
    if (!msg.channel) return;
    if (this.flags.raw) log(`RECV [${msg.channel}] type=${msg.type ?? "update"}`);

    if (msg.channel === "accountState") {
      const data = msg.data ?? {};
      if (!this.accountId) {
        const aid = data.aid ?? data.accountId ?? data.account_id ?? null;
        if (aid) {
          this.accountId = String(aid);
          log(`accountId = ${this.accountId}（来自 WS 快照）`);
        }
      }
      this.positions = Array.isArray(data.P) ? data.P.map(parseWsPosition) : [];
      if (Array.isArray(data.B)) {
        const m = new Map();
        for (const b of data.B) if (b?.a != null && b?.px != null) m.set(String(b.a), Number(b.px));
        this.markByCoin = m;
      }
      const fp = JSON.stringify(data.P ?? []) + "|" + JSON.stringify(data.O ?? []);
      if (fp !== this.stateFp) {
        this.stateFp = fp;
        this.scheduleFetch();
      }
      return;
    }

    if (msg.channel === "accountTrade") this.scheduleFetch();
  }

  scheduleFetch() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fetchAndReport(), this.debounceMs);
  }

  async fetchAndReport() {
    if (this.fetching) {
      this.scheduleFetch();
      return;
    }
    this.fetching = true;
    try {
      if (!this.accountId) {
        this.accountId = await resolveAccountIdViaChain(this.env, this.address);
        if (!this.accountId) {
          log("无法解析 accountId（WS 快照无 aid 且 chain api 未返回），跳过");
          return;
        }
        log(`accountId = ${this.accountId}（来自 chain api）`);
      }

      const fetchOpts = this.fetchAll ? { all: true } : { limit: this.historyLimit };
      let result = null;
      try {
        result = await fetchTradesNext(this.env, this.accountId, fetchOpts);
      } catch (err) {
        log(`[next 主路失败] ${err.message}`);
        if (this.enableWebFallback) {
          result = await fetchTradesWeb(this.env, this.accountId, fetchOpts).catch((e) => {
            log(`[web 备路失败] ${e.message}`);
            return null;
          });
        }
      }
      const trades = result?.trades ?? [];

      const latestTradeId = trades[0]?.trade_id ?? trades[0]?.tradeId ?? "";
      const outFp = JSON.stringify(this.positions.map((p) => [p.symbol, p.posSide, p.size])) + "|" + latestTradeId;
      if (outFp === this.lastOutFp) return;
      this.lastOutFp = outFp;

      const events = diffPositions(this.lastPositions, this.positions);
      this.lastPositions = this.positions;

      const newKeys = new Set();
      for (const t of trades) {
        const k = tradeKey(t);
        if (!this.seenTradeIds.has(k)) {
          this.seenTradeIds.add(k);
          if (this.baselineLogged) newKeys.add(k);
        }
      }
      this.baselineLogged = true;

      const newFills = trades.filter((t) => newKeys.has(tradeKey(t)));
      const clock = ts();

      console.log("");
      console.log(buildEventBanner(clock, newFills, this.positions, events));
      log(`account_id=${this.accountId}`);
      console.log("\n--- 当前仓位 Positions ---");
      console.log(renderPositions(this.positions, this.markByCoin));
      console.log("\n--- 成交历史 Trade History ---");
      console.log(renderTrades(trades, newKeys));
      if (this.flags.raw && result?.raw) {
        console.log("\n--- raw trades ---");
        console.log(JSON.stringify(result.raw, null, 2));
      }
      console.log("=".repeat(60) + "\n");

      // Telegram 推送
      const tgText = buildTgMessage(clock, events, newFills, this.positions, this.markByCoin, trades, newKeys);
      sendTelegram(this.tgToken, this.tgChat, tgText);
    } finally {
      this.fetching = false;
    }
  }

  close() {
    this.closing = true;
    this.clearTimers();
    try {
      this.ws?.close();
    } catch {}
  }
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
    this.env = env;
    this.address = address;
    this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 10);
    this.fetchAll = flags.all === true || flags.all === "true";
    this.at = String(flags.at ?? "20:00");
    this.enableWebFallback =
      flags["enable-web-fallback"] === true || flags["enable-web-fallback"] === "true";
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
    if (process.stdin.isTTY) {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", () => this.fetchAndReport("按需快照"));
      log(`按需抓取：终端回车，或 kill -USR1 ${process.pid}`);
    } else {
      log(`按需抓取：kill -USR1 ${process.pid}`);
    }
  }

  scheduleDaily() {
    const ms = msUntilNextShanghai(this.at);
    this.timer = setTimeout(async () => {
      await this.fetchAndReport(`每日快照 ${this.at}`);
      this.scheduleDaily();
    }, ms);
    log(`下次每日抓取：${this.at} 上海时间（约 ${Math.round(ms / 60000)} 分钟后）`);
  }

  async fetchSnapshot() {
    const stateJson = await httpGetJson(
      `${this.env.gateway}/api/v1/perps/accounts/${this.address}/state`,
    );
    const data = stateJson?.data ?? stateJson ?? {};
    const positions = Array.isArray(data.P) ? data.P.map(parseWsPosition) : [];
    const markByCoin = new Map();
    if (Array.isArray(data.B))
      for (const b of data.B) if (b?.a != null && b?.px != null) markByCoin.set(String(b.a), Number(b.px));
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
      if (!snap.accountId) {
        log("无法解析 accountId（/state 无 aid 且 chain api 未返回），跳过");
        return;
      }
      const fetchOpts = this.fetchAll ? { all: true } : { limit: this.historyLimit };
      let result = null;
      try {
        result = await fetchTradesNext(this.env, snap.accountId, fetchOpts);
      } catch (err) {
        log(`[next 主路失败] ${err.message}`);
        if (this.enableWebFallback)
          result = await fetchTradesWeb(this.env, snap.accountId, fetchOpts).catch((e) => {
            log(`[web 备路失败] ${e.message}`);
            return null;
          });
      }
      const trades = result?.trades ?? [];

      const newKeys = new Set();
      for (const t of trades) {
        const k = tradeKey(t);
        if (!this.seenTradeIds.has(k)) {
          this.seenTradeIds.add(k);
          if (this.baselineLogged) newKeys.add(k);
        }
      }
      this.baselineLogged = true;
      const events = diffPositions(this.lastPositions, snap.positions);
      this.lastPositions = snap.positions;

      console.log("\n" + boxBanner([
        `⚡ SNAPSHOT · ${reason}`,
        `   ${nowShanghai()} (UTC+8) · account_id=${snap.accountId}`,
        ...events.map((e) => `   ${e}`),
      ]));
      console.log("\n--- 当前仓位 Positions ---");
      console.log(renderPositions(snap.positions, snap.markByCoin));
      console.log("\n--- 成交历史 Trade History ---");
      console.log(renderTrades(trades, newKeys));
      if (this.flags.raw && result?.raw) {
        console.log("\n--- raw trades ---");
        console.log(JSON.stringify(result.raw, null, 2));
      }
      console.log("=".repeat(60) + "\n");

      // Telegram 推送
      const newFills = trades.filter((t) => newKeys.has(tradeKey(t)));
      const tgText = buildTgMessage(nowShanghai(), events, newFills, snap.positions, snap.markByCoin, trades, newKeys);
      sendTelegram(this.tgToken, this.tgChat, tgText);
    } catch (e) {
      log(`快照失败：${e.message}`);
    } finally {
      this.running = false;
    }
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
  }
}

// ---------- 入口 ----------
async function main() {
  const { address, flags } = parseArgs(process.argv.slice(2));
  if (!isAddress(address)) {
    console.error(
      "用法: node watch-account.mjs 0xAddress [模式] [选项]\n" +
        "  模式：默认实时 WS 监听；--snapshot 快照模式（按需 + 每日定时，REST，无持久 WS）\n" +
        "  --snapshot 选项：--at=HH:MM（每日抓取时间，上海 UTC+8，默认 20:00）；按需触发 kill -USR1 <pid> 或终端回车\n" +
        "  Telegram：--tg-token=BOT_TOKEN --tg-chat=CHAT_ID\n" +
        "  通用：--all / --history-limit=N（默认 10）/ --enable-web-fallback / --account-id=N / --raw\n" +
        "  实时模式额外：--debounce-ms=N",
    );
    process.exit(1);
  }
  const env = ENVS[flags.env ?? "production"];
  if (!env) {
    console.error(`未知 env: ${flags.env}`);
    process.exit(1);
  }

  await refreshSymbols(env).catch((e) => log(`符号列表拉取失败（不阻断）：${e.message}`));
  setInterval(() => refreshSymbols(env).catch(() => {}), SYMBOLS_REFRESH_MS);

  const snapshotMode = flags.snapshot === true || flags.snapshot === "true";
  const runner = snapshotMode
    ? new SnapshotMode(env, address, flags)
    : new AccountWatcher(env, address, flags);
  log(snapshotMode ? "模式：snapshot（按需 + 每日定时）" : "模式：实时 WS 监听");
  runner.start();

  process.on("SIGINT", () => {
    log("收到 SIGINT，关闭");
    runner.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
