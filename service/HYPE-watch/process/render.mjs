// 纯渲染层：持仓派生 + 离场单展示 + banner + console 表格 + 平仓历史 + Telegram 消息。
// console / TG 两端统一口径。归一模型自带 szDecimals/pricePrecision/mark/roe，无需符号缓存反推。
import { fmtNum, fmtUsd, fmtPct, fmtTimeShort, directionCN } from "../../tool/format.mjs";
import { WATCH_BANNER_LABEL, EXIT_ORDER_BANNER_LABEL } from "../../const/bannerLabels.mjs";

function marginModeLabel(mode) {
  if (/cross/i.test(mode)) return "Cross";
  if (/iso/i.test(mode)) return "Isolated";
  return mode || "-";
}

// 共享持仓派生：归一模型大部分字段直接用，roe 比例转百分比。
export function derivePositionView(p) {
  return {
    coin: p.coin,
    dir: p.dir,
    dirCN: directionCN(p.dir),
    absSize: Math.abs(p.size),
    lev: p.leverage.value,
    marginMode: p.leverage.mode,
    entry: p.entry,
    mark: p.mark,
    value: p.positionValue,
    uPnl: p.unrealizedPnl,
    roe: Number.isFinite(p.roe) ? p.roe * 100 : null,
    liqPrice: p.liqPrice,
    marginUsed: Number.isFinite(p.marginUsed) ? p.marginUsed : null,
    pricePrecision: p.pricePrecision,
    qtyPrecision: Math.min(p.szDecimals, 6),
  };
}

// 匹配某仓的离场单（HYPE 单向，按 coin 匹配即可）并生成展示行。
export function exitOrderLines(position, view, exitOrders) {
  return exitOrders.filter((o) => o.coin === position.coin).map((o) => exitOrderLine(view, o));
}

// 单条离场单展示行（离场单消息 / 卡片共用）。order：{ price, size, kind }。
export function exitOrderLine(view, order) {
  const full = Number.isFinite(order.size) && Number.isFinite(view.absSize) && order.size >= view.absSize - 1e-12;
  const qtyStr = fmtNum(order.size, view.qtyPrecision);
  const amt = full ? `全平 ${qtyStr}` : `部分 ${qtyStr} / ${fmtNum(view.absSize, view.qtyPrecision)}`;
  const labelPart = order.kind ? `${order.kind === "TP" ? "止盈" : "止损"} ` : "";
  return `离场挂单  ${labelPart}@ ${fmtNum(order.price, view.pricePrecision)} (${amt})`;
}

// banner 三行：动作(emoji+动词) / 时间(🕐) / 身份(📡+displayId)
const BANNER_EMOJI = { START: "👀", OPEN: "🟢", CLOSE: "🔴", INCREASE: "📈", REDUCE: "📉", SNAPSHOT: "📸" };
const EXIT_ORDER_EMOJI = "🏹";
function bannerHead(displayId, kind, clock) {
  return `${BANNER_EMOJI[kind]} ${WATCH_BANNER_LABEL[kind]}\n🕐 ${clock}\n📡 ${displayId}`;
}

// 离场单消息头：动作细化（place/cancel/modify/mixed）。
function exitBannerHead(displayId, action, clock) {
  const verb = EXIT_ORDER_BANNER_LABEL[action] ?? EXIT_ORDER_BANNER_LABEL.mixed;
  return `${EXIT_ORDER_EMOJI} ${verb}\n🕐 ${clock}\n📡 ${displayId}`;
}

// 仅用于 console 单条聚合全景取主动词；TG 已按币种/动作拆条。无动词 → { kind: null }（离场单/抖动分流）。
export function classifyBanner(events) {
  const verbs = events.map((e) => e.split(" ")[0]);
  if (verbs.includes("OPENED")) return { kind: "OPEN" };
  if (verbs.includes("CLOSED")) return { kind: "CLOSE" };
  if (verbs.includes("INCREASED")) return { kind: "INCREASE" };
  if (verbs.includes("DECREASED")) return { kind: "REDUCE" };
  return { kind: null };
}

const SEP = "━━━━━━━━━━";

// 追加一张仓位卡片。opts 同 sodex：star / change / marginChange / exitLines（缺省按 exitOrders 生成）。
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
  lines.push(`  强平价  ${v.liqPrice !== null ? fmtNum(v.liqPrice, v.pricePrecision) : "-"}`);
  const modeLabel = marginModeLabel(v.marginMode);
  if (opts.marginChange && opts.marginChange.prevMargin !== null && opts.marginChange.currMargin !== null) {
    const { prevMargin, currMargin } = opts.marginChange;
    const delta = currMargin - prevMargin;
    const sign = delta >= 0 ? "+" : "-";
    lines.push(`  ⭐️ 保证金  ${fmtUsd(prevMargin)} → ${fmtUsd(currMargin)} (${sign}${fmtUsd(Math.abs(delta))}) ${modeLabel}`);
  } else if (v.value !== null) {
    const marginStr = v.marginUsed !== null ? fmtUsd(v.marginUsed) : "-";
    lines.push(`  保证金  ${marginStr} (${modeLabel})`);
  }
  const exitLines = opts.exitLines ?? exitOrderLines(p, v, opts.exitOrders ?? []);
  for (const line of exitLines) lines.push(`  ${line}`);
  lines.push(`${SEP}`);
}

// 全景消息（START / SNAPSHOT）：banner 头 + 全部仓位卡片 + 平仓历史（最近 N 条）。行为不变。
export function buildTgMessage(displayId, kind, clock, positions, exitOrders, closeRecords, newOids, limit, marginSummary, withdrawable) {
  const lines = [bannerHead(displayId, kind, clock)];
  if (positions.length) {
    for (const p of positions) pushPositionCard(lines, p, { exitOrders });
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }
  const history = renderCloseHistory(closeRecords, newOids, limit, true);
  if (history) lines.push(`\n${history}`);
  return lines.join("\n");
}

// 单币仓位变化消息（OPEN / INCREASE / REDUCE）：仅该币卡片，无历史。
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
      marginChange: { prevMargin: prev ? prev.marginUsed : null, currMargin: curr.marginUsed },
    });
  }
  return lines.join("\n");
}

// 平仓合并消息：顶部平仓摘要 + 剩余仓位全景（无则无持仓）+ 底部平仓历史（每币 1 条，⭐️、无“最近N条”）。
export function buildCloseMessage(displayId, clock, closedSummaries, remaining, exitOrders, histRecords, newOids) {
  const lines = [bannerHead(displayId, "CLOSE", clock), ""];
  for (const s of closedSummaries) lines.push(`平仓：${s.coin} ${s.dir}`);
  if (remaining.length) {
    lines.push(`\n剩余仓位：`);
    for (const p of remaining) pushPositionCard(lines, p, { exitOrders });
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }
  const history = renderCloseHistory(histRecords, newOids, histRecords?.length ?? 0, false);
  if (history) lines.push(`\n${history}`);
  return lines.join("\n");
}

// 离场单变化消息：动作细化 banner + 该币完整卡片 + 变化挂单行（⭐️，mixed 追加 [设置]/[撤销]/[调整]）。
export function buildExitOrderMessage(displayId, action, clock, position, entries) {
  const lines = [exitBannerHead(displayId, action, clock)];
  const tag = { place: "设置", cancel: "撤销", modify: "调整" };
  const exitLines = entries.map((e) => `⭐️ ${e.line}${action === "mixed" ? `  [${tag[e.action]}]` : ""}`);
  if (position) {
    pushPositionCard(lines, position, { exitLines });
  } else {
    lines.push(`\n📊 仓位：无持仓`);
    for (const line of exitLines) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

// 平仓历史渲染（按 oid 聚合，一次平仓一行；⭐️ 标新）。无记录返回 null。
// showCount：全景（START/SNAPSHOT）显示“(最近N条)”；事件平仓消息不显示。
export function renderCloseHistory(records, newOids, limit, showCount = true) {
  const list = (records ?? []).slice(0, limit);
  if (!list.length) return null;
  const head = showCount ? `📜 平仓历史 (最近${list.length}条)\n` : `📜 平仓历史\n`;
  const lines = [head];
  for (const r of list) {
    const star = newOids && newOids.has(r.oid) ? "⭐️ " : "";
    lines.push(`  ${star}${r.coin} ${r.dir}  ${fmtTimeShort(r.time)}`);
    lines.push(`  平仓价 ${fmtNum(r.price, 6)}  数量 ${fmtNum(r.size, 6)}`);
    lines.push(`  盈亏 ${fmtUsd(r.closedPnl, true)}  手续费 ${fmtUsd(r.fee, true)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderPositions(positions, exitOrders, marginSummary) {
  if (!positions.length) return "  （无持仓）";
  const header = ["Coin", "方向", "持仓量", "仓位价值", "Entry", "Mark", "Unrealized PnL (ROE%)", "Liq.Price", "保证金", "离场挂单"];
  const rows = positions.map((p) => {
    const v = derivePositionView(p);
    const pnlStr = fmtUsd(v.uPnl, true) + (v.roe !== null ? ` (${fmtPct(v.roe)})` : "");
    const marginStr = v.marginUsed !== null ? `${fmtUsd(v.marginUsed)} ${marginModeLabel(v.marginMode)}` : marginModeLabel(v.marginMode);
    const exit = exitOrderLines(p, v, exitOrders).map((l) => l.replace(/^离场挂单\s+/, "")).join(" / ") || "-";
    return [
      `${v.coin} ${v.lev}x ${v.dir}`,
      v.dirCN,
      `${fmtNum(v.absSize, v.qtyPrecision)} ${v.coin}`,
      v.value !== null ? fmtUsd(v.value) : "-",
      fmtNum(v.entry, v.pricePrecision),
      v.mark !== null ? fmtNum(v.mark, v.pricePrecision) : "-",
      pnlStr,
      v.liqPrice !== null ? fmtNum(v.liqPrice, v.pricePrecision) : "-",
      marginStr,
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

export function buildEventBanner(displayId, kind, clock) {
  return boxBanner(bannerHead(displayId, kind, clock).split("\n"));
}

// console 离场单帧 banner（TG 已按币拆条，console 仍聚合成一条）。
export function buildExitEventBanner(displayId, action, clock) {
  return boxBanner(exitBannerHead(displayId, action, clock).split("\n"));
}
