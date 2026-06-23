// 纯渲染层：持仓派生 + 离场单展示 + banner + console 表格 + 平仓历史 + Telegram 消息。
// console / TG 两端统一口径。import 共享格式化(tool) + 归一(parse) + 符号缓存(api)。
import { isBlank, fmtNum, fmtUsd, fmtPct, fmtTimeShort, directionCN } from "../../tool/format.mjs";
import { baseCoin, positionDirection, marginModeLabel, positionSideCN } from "./parse.mjs";
import { symbolMeta, symbolMetaBySymbol } from "../api/index.mjs";

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
export function exitTpSlLabel(view, order) {
  const price = Number(order.price);
  if (view.mark === null || !Number.isFinite(price)) return "";
  const isTp = view.dir === "LONG" ? price > view.mark : price < view.mark;
  return isTp ? "止盈" : "止损";
}

// banner 三行：动作(emoji+动词) / 时间(🕐) / 身份(📡+displayId)
// displayId 已含【短地址】🎯 label（由 formatDisplayId 产出）
const BANNER_EMOJI = {
  START: "👀",
  OPEN: "🟢",
  CLOSE: "🔴",
  INCREASE: "📈",
  REDUCE: "📉",
  SNAPSHOT: "📸",
  CHANGE: "🔄",
};

const BANNER_VERB = {
  START: "START WATCH",
  OPEN: "OPEN POSITION",
  CLOSE: "CLOSE POSITION",
  INCREASE: "INCREASE POSITION",
  REDUCE: "REDUCE POSITION",
  SNAPSHOT: "SNAPSHOT",
  CHANGE: "POSITION CHANGE",
};

function bannerHead(displayId, kind, clock) {
  const emoji = BANNER_EMOJI[kind] ?? "🔄";
  const verb = BANNER_VERB[kind] ?? "POSITION CHANGE";
  return `${emoji} ${verb}\n🕐 ${clock}\n📡 ${displayId}`;
}

// 由仓位 diff events 判定 banner 类型（START / SNAPSHOT 由调用方按 baseline/reason 决定）。
// 删 trades 后不再有 newFills，动词全部来自 diffPositions 的 events。
export function classifyBanner(events) {
  const verbs = events.map((e) => e.split(" ")[0]);
  if (verbs.includes("OPENED")) return { kind: "OPEN" };
  if (verbs.includes("CLOSED")) return { kind: "CLOSE" };
  if (verbs.includes("INCREASED")) return { kind: "INCREASE" };
  if (verbs.includes("DECREASED")) return { kind: "REDUCE" };
  return { kind: "CHANGE" }; // 无仓位 diff（如纯离场单变化）→ 兜底
}

// 构建 Telegram 消息（样式 F 卡片）。banner 头一行 + 仓位卡片(含离场挂单) + 平仓历史。
export function buildTgMessage(displayId, kind, clock, positions, reduceOnly, posHistory, newPosIds, limit) {
  const lines = [];
  const SEP = "━━━━━━━━━━"; // 隔断线缩为原宽 50%（8 段）

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
export function buildExitOrderBanner(displayId, clock, changes) {
  const verb = { place: "设置", cancel: "撤销", modify: "调整" };
  const lines = [`🏹 离场挂单`, `🕐 ${clock}`, `📡 ${displayId}`];
  for (const c of changes) {
    const tag = c.label ? `${c.label} ` : "";
    lines.push(`${verb[c.action]} ${tag}${c.coin} ${c.dirCN} @ ${c.priceStr}`);
  }
  return lines.join("\n");
}

// 平仓历史渲染（中文「平仓历史」，每条两行 + ★ 标新）。无记录返回 null。
export function renderPositionHistory(records, newIds, limit) {
  const list = (records ?? []).slice(0, limit);
  if (!list.length) return null;
  const lines = [`📜 平仓历史 (最近${list.length}条)\n`];
  for (const r of list) {
    const meta = symbolMeta(r.symbolId);
    const coin = meta.baseCoin || `#${r.symbolId}`;
    const star = newIds && newIds.has(r.positionId) ? "★ " : "";
    const full = Math.abs(Number(r.cumClosedSize)) >= Math.abs(Number(r.maxSize)) - 1e-12;
    lines.push(`  ${star}${coin} ${positionSideCN(r.positionSide)} ${full ? "全平" : "部分"}  ${fmtTimeShort(r.updatedAt)}`);
    lines.push(`  开仓 ${fmtNum(r.avgEntryPrice, meta.pricePrecision)} → 平仓 ${fmtNum(r.avgClosePrice, meta.pricePrecision)}`);
    lines.push(`  数量：${fmtNum(r.cumClosedSize, meta.quantityPrecision)}`);
    lines.push(`  盈亏 ${fmtUsd(r.realizedPnl, true)}  资金费 ${fmtUsd(r.fundingFee, true)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderPositions(positions, reduceOnly) {
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
export function buildEventBanner(displayId, kind, clock) {
  return boxBanner(bannerHead(displayId, kind, clock).split("\n"));
}
