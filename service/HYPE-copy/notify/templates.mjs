// 跟单推送纯文案模板（与逻辑分离）。仅字符串构造 + 事件分类，无 IO、无状态。
// 精度比较走 precision.mjs（禁裸 parseFloat）；HTML 文案经 escapeHtml（sendTelegram 用 parse_mode HTML）。
// 消息风格对齐 watch render.mjs：banner 头 + 卡片式仓位展示 + 分隔线。
import { absStr, gt, lt, eq, signOf, mul, div } from "../process/precision.mjs";

// 事件 icon（用户确认集）
const ICON = {
  open: "🆕", add: "⏫", reduce: "⏬", close: "🏁",
  start: "▶", stop: "⏹", skip: "⛔", minCap: "💡", error: "⚠️",
};
const DIR_CN = { long: "做多", short: "做空", "": "" };

// HTML 转义：reason 等自由文案含 < > & 时防破坏 parse_mode HTML 解析
export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 短地址（notify 自洽，不跨 service import）
const shortAddr = (a) => (typeof a === "string" && a.length >= 10 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a ?? "?");

// 仓位方向：size 符号 → long/short（precision，禁裸 Number 比较）
const posDir = (size) => (signOf(String(size ?? "0")) < 0 ? "short" : "long");

// ratio(number) → 百分比字符串（display；用 precision.mul 避免裸浮点）
const fmtRatioPct = (r) => `${mul(String(r), "100")}%`;

// Display size：szDecimals 位向零截断；未提供则退至 4 位（通知展示用，非下单精度）
import Decimal from "decimal.js";
function fmtDisplaySize(val, szDecimals) {
  if (val == null || val === "") return "0";
  const dec = szDecimals != null ? szDecimals : 4;
  try { return new Decimal(val).toDecimalPlaces(dec, Decimal.ROUND_DOWN).toString(); }
  catch { return String(val); }
}

// Display 金额/本金：2 位小数
function fmtDisplayUsd(val) {
  if (val == null || val === "") return "0";
  try { return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_DOWN).toString(); }
  catch { return String(val); }
}

// 格式化北京时间（与 watch fmtTime 同口径）
export function fmtClock(tsMs) {
  const d = tsMs != null ? new Date(Number(tsMs)) : new Date();
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/-/g, "/");
}

// ---------- Banner 头部 ----------

// 轮次动作 → banner 动词
const BANNER_ACTION = {
  initial_sync: "跟单启动",
  round: "跟单对账",
  startup: "跟单启动",
  shutdown: "跟单关闭",
};

function buildBanner(kind, clock, headerId) {
  const icon = kind === "shutdown" ? ICON.stop
    : kind === "startup" ? ICON.start
    : kind === "initial_sync" ? ICON.start
    : ICON.add;
  const action = BANNER_ACTION[kind] ?? "跟单对账";
  return `${icon} ${action}\n🕐 ${clock}\n📡 ${headerId}`;
}

// ---------- 消息头 ----------

// 头部标识（不含 banner 动作/时间，仅 ID 行）
export function buildHeader(targetId, targetAddr, subAccount) {
  const sub = subAccount ? ` → ${subAccount}` : "";
  return `跟 ${shortAddr(targetAddr)} 🎯${targetId}${sub}  [DRY-RUN]`;
}

// ---------- 启动行 ----------

export function lineStart(extra = "") {
  return extra ? `目标状态：${extra}` : null; // 仅在有额外信息时出单行，否则由 buildBanner 覆盖
}

// ---------- 初始镜像同步：仓位卡片 ----------

// positions: [{coin, size, leverage, szDecimals, refPx, marginUsed, targetEntryPx, targetSzi}]
// 分两个卡片：🎯 目标仓位（来源数据） + 📊 跟单仓位（我方镜像）
export function buildPositionCards(positions) {
  if (!positions || positions.length === 0) return "🎯 目标 / 📊 跟单：（无可映射仓）";

  const SEP = "━━━━━━━━━━";
  const lines = [];
  for (const p of positions) {
    const absSize = absStr(p.size ?? "0");
    if (absSize === "0") continue;
    const dir = posDir(p.size);
    const dirCN = DIR_CN[dir];
    const levStr = p.leverage ? `${p.leverage}x ` : "";
    const szDec = p.szDecimals;
    const px = p.refPx;
    const entry = p.targetEntryPx ? fmtDisplayUsd(p.targetEntryPx) : null;
    const targetAbs = p.targetSzi ? absStr(p.targetSzi) : null;
    const targetDisplay = targetAbs ? fmtDisplaySize(targetAbs, szDec) : null;
    const targetMargin = p.marginUsed ? fmtDisplayUsd(p.marginUsed) : null;

    // 目标仓位卡片（信号源原始数据）
    const targetLines = [];
    targetLines.push(`🎯 目标仓位：${p.coin} ${levStr}${dirCN}`);
    if (targetDisplay) targetLines.push(`  持仓量  ${targetDisplay} 张`);
    if (entry) targetLines.push(`  开仓价  $${entry}`);
    if (px) targetLines.push(`  标记价  $${fmtDisplayUsd(px)}`);
    if (targetMargin) targetLines.push(`  保证金  $${targetMargin}`);
    if (targetLines.length > 1) { lines.push(`${SEP}`); lines.push(...targetLines); lines.push(""); }

    // 跟单仓位卡片（我方按 ratio 缩放后）
    const displaySize = fmtDisplaySize(absSize, szDec);
    const notional = px ? fmtDisplayUsd(mul(absSize, String(px))) : null;
    const mirrorMargin = px && p.leverage ? fmtDisplayUsd(div(mul(absSize, String(px)), String(p.leverage))) : null;
    const mirrorLines = [];
    mirrorLines.push(`📊 跟单仓位：${p.coin} ${levStr}${dirCN}`);
    mirrorLines.push(`  持仓量  ${displaySize} 张`);
    if (notional) mirrorLines.push(`  仓位价值  $${notional}`);
    if (mirrorMargin) mirrorLines.push(`  保证金  $${mirrorMargin}`);
    lines.push(...mirrorLines);
    lines.push(`${SEP}`);
  }
  return lines.join("\n");
}

// 单币种变化行（open/add/reduce/close）
// ev: {coin, side, currentSize, desiredSize, deltaSize, refPx, ratio, szDecimals, posLeverage}
function buildDeltaLine(ev) {
  const ev2 = classifyMirrorEvent(ev.currentSize, ev.desiredSize);
  const dir = DIR_CN[posDir(ev2 === "close" ? ev.currentSize : ev.desiredSize)];
  const szDec = ev.szDecimals;
  const px = ev.refPx ? `$${fmtDisplayUsd(ev.refPx)}` : "-";
  const ratioText = ev.ratio != null ? `ratio ${fmtRatioPct(ev.ratio)}` : "";

  switch (ev2) {
    case "open": {
      const held = fmtDisplaySize(absStr(ev.desiredSize ?? "0"), szDec);
      return `${ICON.open} ${ev.coin} ${dir} | 新开 ${held} 张 @ ${px}  ${ratioText}`;
    }
    case "add": {
      const delta = fmtDisplaySize(absStr(ev.deltaSize ?? "0"), szDec);
      const held = fmtDisplaySize(absStr(ev.desiredSize ?? "0"), szDec);
      return `${ICON.add} ${ev.coin} ${dir} | +${delta} → 持 ${held} 张 @ ${px}`;
    }
    case "reduce": {
      const delta = fmtDisplaySize(absStr(ev.deltaSize ?? "0"), szDec);
      const held = fmtDisplaySize(absStr(ev.desiredSize ?? "0"), szDec);
      return `${ICON.reduce} ${ev.coin} ${dir} | -${delta} → 持 ${held} 张 @ ${px}`;
    }
    case "close":
      return `${ICON.close} ${ev.coin} ${dir} | 目标已清仓，平仓`;
    default:
      return null;
  }
}

// ---------- lineFor(action) → 明细行字符串 ----------

export function lineFor(a) {
  const result = a.result ?? a.decision ?? "ok";
  const coin = a.coin;
  switch (result) {
    case "noop":
    case "same":
      return null;
    case "place":
    case "ok":
      return buildDeltaLine(a);
    case "skip-unmappable":
      return `${ICON.skip} ${coin} 无 hype 映射，跳过（不计入分母）`;
    case "skip-mindust":
      return `${ICON.skip} ${coin} 名义 < 最小 $10，跳过`;
    case "skip-no-price":
      return `${ICON.skip} ${coin} 无价格数据，本轮跳过`;
    case "skip-maxpos": {
      // 仓位过重不跟：目标仓按比例缩小后仍需 X，超单仓风控上限
      const notional = a.positionNotional ? `$${fmtDisplayUsd(a.positionNotional)}` : "";
      const limit = a.maxPosNotional ? `$${fmtDisplayUsd(a.maxPosNotional)}` : "单仓上限";
      const limitFormula = a.maxPosNotional ? `（余额 $${fmtDisplayUsd(a.availBalance)} × ${a.maxPositionPct ? fmtRatioPct(a.maxPositionPct) : ""}）` : "";
      return `${ICON.skip} ${coin} 仓位过重不跟${notional ? `——目标仓按比例缩小后仍需 ${notional}` : ""}，超单仓上限 ${limit}${limitFormula}`;
    }
    case "skip-capped": {
      const would = a.wouldDeploy ? `需 $${fmtDisplayUsd(a.wouldDeploy)}` : "部署需求";
      const limit = a.maxDeployNotional ? `资金上限 $${fmtDisplayUsd(a.maxDeployNotional)}` : "超资金上限";
      return `${ICON.skip} ${coin} ${would} > ${limit}，加仓拦截`;
    }
    case "min-capital": {
      const mc = fmtDisplayUsd(a.minCapital ?? "0");
      const coins = a.canFollowCoins ?? "-";
      return `${ICON.minCap} 最低本金参考：$${mc}（可跟 ${coins}）`;
    }
    case "failed":
    case "error":
      return `${ICON.error} ${coin} 执行失败 — ${escapeHtml(a.reason ?? "未知")}`;
    default:
      return null;
  }
}

// ---------- 兼容旧调用（lineInitialSync → buildPositionCards）----------

export function lineInitialSync(positions) {
  return buildPositionCards(positions);
}

// ---------- 关闭行 ----------

export function lineStop() {
  return `${ICON.stop} 跟单关闭`;
}

// ---------- 计时页脚 ----------

export function buildFooter(execMs, fullMs) {
  return `⏱ 执行 ${execMs}ms｜完整 ${fullMs}ms`;
}

// ---------- 轮次汇总构建（替代 pushRoundSummary 的拼接逻辑）----------

// buildRoundSummary 产出一轮完整 TG 消息文本：banner + 仓位卡片 + 明细行 + 页脚
// kind: 'initial_sync' | 'round' | 'startup' | 'shutdown'
export function buildRoundSummary({ kind, clock, headerId, positionCards, lines, footer, startupExtra }) {
  const banner = buildBanner(kind, clock, headerId);
  const parts = [banner];

  if (startupExtra) parts.push(startupExtra);
  if (positionCards) parts.push(`\n${positionCards}`);
  if (lines && lines.length > 0) parts.push(`\n${lines.join("\n")}`);
  if (footer) parts.push(`\n${footer}`);

  return parts.join("\n");
}

// ---------- 镜像变化分类（总纲事件分类表）----------

export function classifyMirrorEvent(prevSize, newSize) {
  const p = absStr(prevSize ?? "0");
  const n = absStr(newSize ?? "0");
  if (eq(p, "0") && gt(n, "0")) return "open";
  if (eq(n, "0") && gt(p, "0")) return "close";
  if (gt(n, p)) return "add";
  if (lt(n, p)) return "reduce";
  return "same";
}

// re-export 供外部使用
export { fmtDisplaySize, fmtDisplayUsd };
