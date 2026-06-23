// 纯渲染层：持仓派生 + 离场单展示 + banner + console 表格 + 平仓历史 + Telegram 消息。
// console / TG 两端统一口径。归一模型自带 szDecimals/pricePrecision/mark/roe，无需符号缓存反推。
import { fmtNum, fmtUsd, fmtPct, fmtTimeShort, directionCN } from "../../tool/format.mjs";

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
    pricePrecision: p.pricePrecision,
    qtyPrecision: Math.min(p.szDecimals, 6),
  };
}

// 匹配某仓的离场单（HYPE 单向，按 coin 匹配即可）并生成展示行。
export function exitOrderLines(position, view, exitOrders) {
  const matches = exitOrders.filter((o) => o.coin === position.coin);
  return matches.map((o) => {
    const full = Number.isFinite(o.size) && Number.isFinite(view.absSize) && o.size >= view.absSize - 1e-12;
    const qtyStr = fmtNum(o.size, view.qtyPrecision);
    const amt = full ? `全平 ${qtyStr}` : `部分 ${qtyStr} / ${fmtNum(view.absSize, view.qtyPrecision)}`;
    const labelPart = o.kind ? `${o.kind === "TP" ? "止盈" : "止损"} ` : "";
    return `离场挂单  ${labelPart}@ ${fmtNum(o.price, view.pricePrecision)} (${amt})`;
  });
}

// banner 三行：动作(emoji+动词) / 时间(🕐) / 身份(📡+displayId)
const BANNER_EMOJI = { START: "👀", OPEN: "🟢", CLOSE: "🔴", INCREASE: "📈", REDUCE: "📉", SNAPSHOT: "📸", CHANGE: "🔄" };
const BANNER_VERB = { START: "START WATCH", OPEN: "OPEN POSITION", CLOSE: "CLOSE POSITION", INCREASE: "INCREASE POSITION", REDUCE: "REDUCE POSITION", SNAPSHOT: "SNAPSHOT", CHANGE: "POSITION CHANGE" };

function bannerHead(displayId, kind, clock) {
  const emoji = BANNER_EMOJI[kind] ?? "🔄";
  const verb = BANNER_VERB[kind] ?? "POSITION CHANGE";
  return `${emoji} ${verb}\n🕐 ${clock}\n📡 ${displayId}`;
}

export function classifyBanner(events) {
  const verbs = events.map((e) => e.split(" ")[0]);
  if (verbs.includes("OPENED")) return { kind: "OPEN" };
  if (verbs.includes("CLOSED")) return { kind: "CLOSE" };
  if (verbs.includes("INCREASED")) return { kind: "INCREASE" };
  if (verbs.includes("DECREASED")) return { kind: "REDUCE" };
  return { kind: "CHANGE" };
}

// 构建 Telegram 消息（样式 F 卡片）。
export function buildTgMessage(displayId, kind, clock, positions, exitOrders, closeRecords, newOids, limit) {
  const lines = [];
  const SEP = "━━━━━━━━━━";
  lines.push(bannerHead(displayId, kind, clock));

  if (positions.length) {
    for (const p of positions) {
      const v = derivePositionView(p);
      lines.push(`\n${SEP}`);
      lines.push(`📊 仓位：${v.coin} ${v.lev}x ${v.dir}`);
      lines.push(`  方向  ${v.dirCN}`);
      lines.push(`  持仓量  ${fmtNum(v.absSize, v.qtyPrecision)}`);
      lines.push(`  仓位价值  ${v.value !== null ? fmtUsd(v.value) : "-"}`);
      lines.push(`  开仓价  ${fmtNum(v.entry, v.pricePrecision)}`);
      lines.push(`  标记价  ${v.mark !== null ? fmtNum(v.mark, v.pricePrecision) : "-"}`);
      lines.push(`  未结盈亏  ${fmtUsd(v.uPnl, true)}${v.roe !== null ? ` (${fmtPct(v.roe)})` : ""}`);
      lines.push(`  强平价  ${v.liqPrice !== null ? fmtNum(v.liqPrice, v.pricePrecision) : "-"}`);
      if (v.value !== null) lines.push(`  保证金模式  ${marginModeLabel(v.marginMode)}`);
      for (const line of exitOrderLines(p, v, exitOrders)) lines.push(`  ${line}`);
      lines.push(`${SEP}`);
    }
  } else {
    lines.push(`\n📊 仓位：无持仓`);
  }

  const history = renderCloseHistory(closeRecords, newOids, limit);
  if (history) lines.push(`\n${history}`);
  return lines.join("\n");
}

// 平仓历史渲染（按 oid 聚合，一次平仓一行；★ 标新）。无记录返回 null。
export function renderCloseHistory(records, newOids, limit) {
  const list = (records ?? []).slice(0, limit);
  if (!list.length) return null;
  const lines = [`📜 平仓历史 (最近${list.length}条)\n`];
  for (const r of list) {
    const star = newOids && newOids.has(r.oid) ? "★ " : "";
    lines.push(`  ${star}${r.coin} ${r.dir}  ${fmtTimeShort(r.time)}`);
    lines.push(`  平仓价 ${fmtNum(r.price, 6)}  数量 ${fmtNum(r.size, 6)}`);
    lines.push(`  盈亏 ${fmtUsd(r.closedPnl, true)}  手续费 ${fmtUsd(r.fee, true)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderPositions(positions, exitOrders) {
  if (!positions.length) return "  （无持仓）";
  const header = ["Coin", "方向", "持仓量", "仓位价值", "Entry", "Mark", "Unrealized PnL (ROE%)", "Liq.Price", "Margin", "离场挂单"];
  const rows = positions.map((p) => {
    const v = derivePositionView(p);
    const pnlStr = fmtUsd(v.uPnl, true) + (v.roe !== null ? ` (${fmtPct(v.roe)})` : "");
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
      marginModeLabel(v.marginMode),
      exit,
    ];
  });
  const w = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

// 离场挂单变化轻提醒（独立 banner）。changes: [{action, coin, dirCN, priceStr, label}]
export function buildExitOrderBanner(displayId, clock, changes) {
  const verb = { place: "设置", cancel: "撤销", modify: "调整" };
  const lines = [`🏹 离场挂单`, `🕐 ${clock}`, `📡 ${displayId}`];
  for (const c of changes) {
    const tag = c.label ? `${c.label} ` : "";
    lines.push(`${verb[c.action]} ${tag}${c.coin} ${c.dirCN} @ ${c.priceStr}`);
  }
  return lines.join("\n");
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
