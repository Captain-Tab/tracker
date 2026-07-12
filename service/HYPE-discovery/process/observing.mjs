// ⑥ observing 观察态：discovery ⑤ 输出后同进程运行，自动维护 HYPE-watch/watch-observing.json。
// 连续 2 周过硬门槛 → 🟢 结算推荐升 watch；断 streak → 🔴 移出（绝不自动 park）；新入 → 🟡 观察第 1 周。
// 只写 observing 一个文件；watch/parked 全人工。异常被捕获，不中断 ①-⑤。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendTelegram } from "./output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMOTE_WEEKS = 2; // 连续 N 周达标即结算推荐升 watch
const MAX_LIST = 5;      // 🔴/🟡 每段展示上限
const HIGHLIGHT_MAX = 2; // 🟢 近期精彩笔数
const MS_PER_DAY = 86_400_000;

// ISO 周 id：YYYY-Www（周去重 / 展示口径）
function isoWeekId(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // 移到本周四
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const pad2 = (n) => String(n).padStart(2, "0");
function localStamp(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
function beijingDay(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function shortAddr(a) {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

// 紧凑 USD：$12k / $4.2k / $1.5M（对齐通知 mockup）
function compactUsd(v, signed = false) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : signed && x > 0 ? "+" : "";
  const a = Math.abs(x);
  let s;
  if (a >= 1e6) s = `${(a / 1e6).toFixed(1)}M`;
  else if (a >= 1e3) s = `${(a / 1e3).toFixed(1)}k`.replace(".0k", "k");
  else s = `${Math.round(a)}`;
  return `${sign}$${s}`;
}
function fmtRatio(v) {
  if (v === Infinity) return "∞";
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(2) : "-";
}
function fmtPct(r) {
  const x = Number(r);
  return Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "-";
}

// observing 文件自带读写（不经 watchCandidates 的 {date,reason} schema，避免富字段被丢弃）
function loadObserving(path) {
  try {
    const o = JSON.parse(readFileSync(path, "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
function saveObserving(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

// 近期精彩：盈利交易按 pnl 降序取前 N，展示 币种 +pnl（几天前）
function topHighlights(trades, now) {
  return (Array.isArray(trades) ? trades : [])
    .filter((t) => t.pnl > 0)
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, HIGHLIGHT_MAX)
    .map((t) => `${t.coin} ${compactUsd(t.pnl, true)}（${Math.max(0, Math.round((now - t.closeMs) / MS_PER_DAY))}天前）`);
}

// 构造 TG「观察态」消息（顺序 🟢→🔴→🟡）。三段全空 → 返回 null（静默不推）
export function buildObservingTgMessage(decisions, dayLabel) {
  const { promoted, removed, watching } = decisions;
  if (!promoted.length && !removed.length && !watching.length) return null;
  const L = [`🔬 HYPE 观察态 · ${dayLabel}`];

  if (promoted.length) {
    L.push("");
    L.push(`🟢 结算·升 watch（连续 ${PROMOTE_WEEKS} 周达标）`);
    promoted.forEach((p, i) => {
      L.push(`  #${i + 1} 📡 ${shortAddr(p.address)} 评分${p.score} · 盈亏比${fmtRatio(p.profitFactor)} · 胜率${fmtPct(p.winRate)} · 净额${compactUsd(p.netProfit)} · 观察${p.weeks}周`);
      if (p.highlights.length) L.push(`     近期精彩：${p.highlights.join(" · ")}`);
    });
  }
  if (removed.length) {
    L.push("");
    L.push(`🔴 本周移出（断 streak）`);
    removed.slice(0, MAX_LIST).forEach((r) => L.push(`  📡 ${shortAddr(r.address)} 上周评分${r.lastScore} · ${r.reason}`));
    if (removed.length > MAX_LIST) L.push(`  …另有 ${removed.length - MAX_LIST} 个移出`);
  }
  if (watching.length) {
    L.push("");
    L.push(`🟡 观察中（第 1 周，下周结算）`);
    watching.slice(0, MAX_LIST).forEach((o) => L.push(`  📡 ${shortAddr(o.address)} 评分${o.score}`));
    if (watching.length > MAX_LIST) L.push(`  …另有 ${watching.length - MAX_LIST} 个观察中`);
  }
  return L.join("\n");
}

/**
 * ⑥ observing 阶段入口。
 * @param {Array} scored - ④打分全量带分列表（pre-topK）
 * @param {Array} evalEliminated - ③淘汰逐址记录 {address,stage,reason}
 * @param {object} ctx - { dryRun, noPush, logDir, tgToken, tgChat, generatedAt:Date, excludeSet:Set }
 */
export async function observing(scored, evalEliminated, ctx) {
  try {
    const { dryRun, noPush, logDir, tgToken, tgChat, generatedAt, excludeSet } = ctx;
    const genDate = generatedAt instanceof Date ? generatedAt : new Date();
    const now = genDate.getTime();
    const weekId = isoWeekId(genDate);

    const observingPath = join(__dirname, "..", "..", "HYPE-watch", "watch-observing.json");
    const obs = loadObserving(observingPath);
    const excl = new Set([...(excludeSet ?? [])].map((a) => String(a).toLowerCase()));

    // 本周合格集（∉watch ∉parked），按地址小写归一
    const qualified = new Map();
    for (const s of scored ?? []) {
      const addr = String(s.address ?? "").toLowerCase();
      if (!addr || excl.has(addr)) continue;
      qualified.set(addr, s);
    }

    const promoted = [];
    const watching = [];
    const removed = [];

    // 本周合格：续命 / 结算 / 新入
    for (const [addr, s] of qualified) {
      const entry = obs[addr];
      if (entry) {
        if (!Array.isArray(entry.weeksSeen)) entry.weeksSeen = [];
        if (!entry.weeksSeen.includes(weekId)) entry.weeksSeen.push(weekId); // ISO 周去重
        entry.lastScore = s.score;
        if (entry.weeksSeen.length >= PROMOTE_WEEKS && !entry.recommended) {
          entry.recommended = true;
          promoted.push({
            address: addr, score: s.score, profitFactor: s.profitFactor, winRate: s.winRate,
            netProfit: s.netProfit, weeks: entry.weeksSeen.length, highlights: topHighlights(s.trades, now),
          });
        }
      } else {
        obs[addr] = { since: weekId, weeksSeen: [weekId], recommended: false, lastScore: s.score, reason: "" };
        watching.push({ address: addr, score: s.score });
      }
    }

    // observing 里本周未出现：断 streak 移出（绝不 park）
    const elimReason = new Map((evalEliminated ?? []).map((e) => [String(e.address ?? "").toLowerCase(), e.reason]));
    for (const addr of Object.keys(obs)) {
      if (qualified.has(addr)) continue;
      // 已被人工移入 watch/parked（进排除集）→ 静默清出，不报 🔴（是升级/归档，非掉出榜单）
      if (excl.has(addr)) {
        delete obs[addr];
        continue;
      }
      const entry = obs[addr];
      removed.push({
        address: addr,
        lastScore: entry.lastScore ?? "-",
        reason: elimReason.get(addr) || "掉出榜单（pnl/量下滑）",
      });
      delete obs[addr];
    }

    const decisions = { promoted, removed, watching };
    const msg = buildObservingTgMessage(decisions, beijingDay(genDate));

    // dry-run：打印消息到 stdout，不写文件、不发 TG
    if (dryRun) {
      console.log("\n[⑥ observing dry-run]\n" + (msg ?? "（三段全空，静默不推）") + "\n");
      return { promoted: promoted.length, watching: watching.length, removed: removed.length, promotedAddresses: promoted.map((p) => p.address) };
    }

    // 落盘：状态快照 + 决策（每轮都写，供审计）；md = TG 消息完整版
    const stamp = localStamp(genDate);
    const obsDir = join(logDir, "observing");
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(join(obsDir, `observing-${stamp}.json`), JSON.stringify({ generatedAt: genDate.toISOString(), weekId, observing: obs, decisions }, null, 2), "utf8");
    writeFileSync(join(obsDir, `observing-${stamp}.md`), msg ?? `🔬 HYPE 观察态 · ${beijingDay(genDate)}\n\n本周无变动（无结算 / 无移出 / 无新观察）。`, "utf8");

    saveObserving(observingPath, obs);

    // TG：仅非空且非 noPush 时推送
    if (!noPush && msg) await sendTelegram(tgToken, tgChat, msg);

    return { promoted: promoted.length, watching: watching.length, removed: removed.length, promotedAddresses: promoted.map((p) => p.address) };
  } catch (e) {
    console.error(`⑥ observing 失败（不影响 ①-⑤）：${e.message}`);
    return null;
  }
}

export const __internals = { isoWeekId, buildObservingTgMessage, topHighlights, compactUsd, loadObserving };
