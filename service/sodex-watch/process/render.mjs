// 纯渲染层：持仓派生 + 离场单展示 + banner + console 表格 + 平仓历史 + Telegram 消息。
// console / TG 两端统一口径。import 共享格式化(tool) + 归一(parse) + 符号缓存(api)。
import { isBlank, fmtNum, fmtUsd, fmtPct, fmtTimeShort, directionCN } from "../../tool/format.mjs";
import { baseCoin, positionDirection, marginModeLabel, positionSideCN } from "./parse.mjs";
import { symbolMeta, symbolMetaBySymbol } from "../api/index.mjs";
import { WATCH_BANNER_LABEL, EXIT_ORDER_BANNER_LABEL } from "../../const/bannerLabels.mjs";

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
  return matchReduceOnly(position, view, reduceOnly).map((o) => exitOrderLine(view, o));
}

// 单条离场单展示行（离场单消息 / 卡片共用；view 为对应持仓派生，取不到量级则退化仅价）。
export function exitOrderLine(view, order) {
  if (!view) return `离场挂单  @ ${fmtNum(order.price, undefined)}`;
  const label = exitTpSlLabel(view, order);
  const qty = Number(order.qty);
  const full = Number.isFinite(qty) && Number.isFinite(view.absSize) && qty >= view.absSize - 1e-12;
  const qtyStr = fmtNum(order.qty, view.qtyPrecision);
  const amt = full ? `全平 ${qtyStr}` : `部分 ${qtyStr} / ${fmtNum(view.absSize, view.qtyPrecision)}`;
  const labelPart = label ? `${label} ` : "";
  return `离场挂单  ${labelPart}@ ${fmtNum(order.price, view.pricePrecision)} (${amt})`;
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
};
const EXIT_ORDER_EMOJI = "🏹";

function bannerHead(displayId, kind, clock) {
  return `${BANNER_EMOJI[kind]} ${WATCH_BANNER_LABEL[kind]}\n🕐 ${clock}\n📡 ${displayId}`;
}

// 离场单消息头：动作细化（place/cancel/modify/mixed）。
function exitBannerHead(displayId, action, clock) {
  const verb = EXIT_ORDER_BANNER_LABEL[action] ?? EXIT_ORDER_BANNER_LABEL.mixed;
  return `${EXIT_ORDER_EMOJI} ${verb}\n🕐 ${clock}\n📡 ${displayId}`;
}

// 由仓位 diff events 判定 banner 类型（START / SNAPSHOT 由调用方按 baseline/reason 决定）。
// 仅用于 console 单条聚合全景取主动词；TG 已按币种/动作拆条，不再依赖此优先级。
// 无仓位 diff 且无新平仓记录 → 返回 { kind: null }（离场单/纯抖动由消息生成流程分流，不再兜底 CHANGE）。
export function classifyBanner(events, newClosedIds) {
  const verbs = events.map((e) => e.split(" ")[0]);
  // OPENED+CLOSED 同时存在 → 混合事件（如平仓+反手），不偏向任一方
  if (verbs.includes("OPENED") && verbs.includes("CLOSED")) return { kind: "CHANGE" };
  if (verbs.includes("OPENED")) return { kind: "OPEN" };
  if (verbs.includes("CLOSED")) return { kind: "CLOSE" };
  if (verbs.includes("INCREASED")) return { kind: "INCREASE" };
  if (verbs.includes("DECREASED")) return { kind: "REDUCE" };
  // 仓位 diff 未抓到 CLOSED，但本轮有新平仓记录 → 开平被跨帧跳过，凭记录判平仓
  if (newClosedIds?.size > 0) return { kind: "CLOSE" };
  return { kind: null };
}

const SEP = "━━━━━━━━━━"; // 隔断线缩为原宽 50%（8 段）

// 追加一张仓位卡片到 lines。opts：
//   star          仓位标题行前加 ⭐️（开仓定位）
//   change        { verb, prevAbs, currAbs } 在方向行后插入 ⭐️ 增减持仓量级行
//   marginChange  { prevMargin, currMargin } 保证金行改为 prev→curr 带增量并前置 ⭐️
//   exitLines     直接给定离场挂单行（已含 ⭐️/标签）；缺省则按 reduceOnly 生成普通行
function pushPositionCard(lines, p, opts = {}) {
  const v = derivePositionView(p);
  lines.push(`\n${SEP}`);
  lines.push(`${opts.star ? "⭐️ " : ""}📊 仓位：${v.coin} ${v.lev}x ${v.dir}`);
  lines.push(`  方向  ${v.dirCN}`);
  if (opts.change) {
    const { verb, prevAbs, currAbs } = opts.change;
    const delta = currAbs - prevAbs;
    const sign = delta >= 0 ? "+" : "-";
    lines.push(`  ⭐️ ${verb}  ${fmtNum(prevAbs, v.qtyPrecision)} → ${fmtNum(currAbs, v.qtyPrecision)} ${v.coin} (${sign}${fmtNum(Math.abs(delta), v.qtyPrecision)})`);
  }
  lines.push(`  持仓量  ${fmtNum(v.absSize, v.qtyPrecision)}`);
  lines.push(`  仓位价值  ${v.value !== null ? fmtUsd(v.value) : "-"}`);
  lines.push(`  开仓价  ${fmtNum(v.entry, v.pricePrecision)}`);
  lines.push(`  标记价  ${v.mark !== null ? fmtNum(v.mark, v.pricePrecision) : "-"}`);
  lines.push(`  未结盈亏  ${fmtUsd(v.uPnl, true)}${v.roe !== null ? ` (${fmtPct(v.roe)})` : ""}`);
  lines.push(`  强平价  ${fmtNum(v.liqPrice, v.pricePrecision)}`);
  const mode = marginModeLabel(v.marginMode);
  if (opts.marginChange && opts.marginChange.prevMargin !== null && opts.marginChange.currMargin !== null) {
    const { prevMargin, currMargin } = opts.marginChange;
    const delta = currMargin - prevMargin;
    const sign = delta >= 0 ? "+" : "-";
    lines.push(`  ⭐️ 保证金  ${fmtUsd(prevMargin)} → ${fmtUsd(currMargin)} (${sign}${fmtUsd(Math.abs(delta))}) ${mode}`);
  } else if (v.margin !== null) {
    lines.push(`  保证金  ${fmtUsd(v.margin)} (${mode})`);
  }
  const exitLines = opts.exitLines ?? exitOrderLines(p, v, opts.reduceOnly ?? []);
  for (const line of exitLines) lines.push(`  ${line}`);
  lines.push(`${SEP}`);
}

// 全景消息（START / SNAPSHOT）：banner 头 + 全部仓位卡片 + 平仓历史（最近 N 条）。行为不变。
export function buildTgMessage(displayId, kind, clock, positions, reduceOnly, posHistory, newPosIds, limit) {
  const lines = [bannerHead(displayId, kind, clock)];
  const open = positions.filter((p) => Number(p.size) !== 0);
  if (open.length) {
    for (const p of open) pushPositionCard(lines, p, { reduceOnly });
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }
  const history = renderPositionHistory(posHistory, newPosIds, limit, true);
  if (history) lines.push(`\n${history}`);
  return lines.join("\n");
}

// 单币仓位变化消息（OPEN / INCREASE / REDUCE）：仅该币卡片，无历史。
// INCREASE/REDUCE 需 prev 持仓算量级与保证金增量；OPEN 只在标题行前置 ⭐️。
export function buildPositionChangeMessage(displayId, kind, clock, position, prevPosition) {
  const lines = [bannerHead(displayId, kind, clock)];
  if (kind === "OPEN") {
    pushPositionCard(lines, position, { star: true });
  } else {
    const curr = derivePositionView(position);
    const prev = prevPosition ? derivePositionView(prevPosition) : null;
    const verb = kind === "INCREASE" ? "增加持仓" : "减少持仓";
    pushPositionCard(lines, position, {
      change: { verb, prevAbs: prev ? prev.absSize : curr.absSize, currAbs: curr.absSize },
      marginChange: { prevMargin: prev ? prev.margin : null, currMargin: curr.margin },
    });
  }
  return lines.join("\n");
}

// 平仓合并消息：顶部平仓摘要 + 剩余仓位全景（无则无持仓）+ 底部平仓历史（每币 1 条，⭐️、无“最近N条”）。
// closedSummaries: [{ coin, dir }]；remaining: 剩余持仓数组。
export function buildCloseMessage(displayId, clock, closedSummaries, remaining, reduceOnly, histRecords, newPosIds) {
  const lines = [bannerHead(displayId, "CLOSE", clock), ""];
  for (const s of closedSummaries) lines.push(`平仓：${s.coin} ${s.dir}`);
  const open = remaining.filter((p) => Number(p.size) !== 0);
  if (open.length) {
    lines.push(`\n剩余仓位：`);
    for (const p of open) pushPositionCard(lines, p, { reduceOnly });
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }
  const history = renderPositionHistory(histRecords, newPosIds, histRecords?.length ?? 0, false);
  if (history) lines.push(`\n${history}`);
  return lines.join("\n");
}

// 离场单变化消息：动作细化 banner + 该币完整卡片 + 变化挂单行（⭐️，mixed 追加 [设置]/[撤销]/[调整]）。
// entries: 该币的变化条目 [{ action, line }]；position 为对应持仓（可能已不存在）。
export function buildExitOrderMessage(displayId, action, clock, position, entries) {
  const lines = [exitBannerHead(displayId, action, clock)];
  const tag = { place: "设置", cancel: "撤销", modify: "调整" };
  const exitLines = entries.map((e) => `⭐️ ${e.line}${action === "mixed" ? `  [${tag[e.action]}]` : ""}`);
  if (position) {
    pushPositionCard(lines, position, { exitLines });
  } else {
    lines.push(`\n📊 仓位已平仓`);
    for (const line of exitLines) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

// 平仓历史渲染（中文「平仓历史」，每条两行 + ⭐️ 标新）。无记录返回 null。
// showCount：全景（START/SNAPSHOT）显示“(最近N条)”；事件平仓消息不显示。
export function renderPositionHistory(records, newIds, limit, showCount = true) {
  const list = (records ?? []).slice(0, limit);
  if (!list.length) return null;
  const head = showCount ? `📜 平仓历史 (最近${list.length}条)\n` : `📜 平仓历史\n`;
  const lines = [head];
  for (const r of list) {
    const meta = symbolMeta(r.symbolId);
    const coin = meta.baseCoin || `#${r.symbolId}`;
    const star = newIds && newIds.has(r.positionId) ? "⭐️ " : "";
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

// console 离场单帧 banner（TG 已按币拆条，console 仍聚合成一条）。
export function buildExitEventBanner(displayId, action, clock) {
  return boxBanner(exitBannerHead(displayId, action, clock).split("\n"));
}
