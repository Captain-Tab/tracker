// ⑥ observing 观察态：discovery ⑤ 输出后同进程运行，自动维护 sodex-watch/watch-observing.json。
// 连续 2 周过硬门槛 → 🟢 结算推荐升 watch；断 streak → 🔴 移出（绝不自动 park）；新入 → 🟡 观察第 1 周。
// 只写 observing 一个文件；watch/parked 全人工。异常被捕获，不中断 ①-⑤。
// sodex 差异：observing 按 walletAddress 归一 + 存 accountId（🔴 按 accountId 反查 evalElim）；
// 近期精彩用 topTrades 的 symbol_id 经 refreshSymbols 解析币名。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendTelegram } from "./output.mjs";
import { refreshSymbols } from "../api/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMOTE_WEEKS = 2; // 连续 N 周达标即结算推荐升 watch
const MAX_LIST = 5;      // 🔴/🟡/⚠️ 每段展示上限
const MAX_API_RETRIES = 2; // 连续 API 失败上限

// 判断淘汰原因是否为 transient API 错误（应保留而非移出）
function isTransientApiError(reason) {
  if (!reason) return false;
  return /HTTP\s*(429|409|503)|fetch\s*failed|abort/i.test(reason);
}
const HIGHLIGHT_MAX = 2; // 🟢 近期精彩笔数
const MS_PER_DAY = 86_400_000;

// watch-ready 复核阈值：promote（2周持续性）之后，更严格的质量门槛
const WATCH_READY_SODEX = {
  scoreMin: 55,
  activeDaysMin: 21,
  nTradesMin: 20,
  pfMin: 2.0,
  maxLossRatio: 0.5, // maxLoss / netProfit
};

// ISO 周 id：YYYY-Www
function isoWeekId(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
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

// 紧凑 USD：$12k / $4.2k / $1.5M
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

// 自动生成 label：top-2 盈利币种去重拼接（sodex 用 symbolMap 解析 symbol_id→币名，空 map 回退 #<id>）
function generateLabel(topTrades, symbolMap) {
  const coins = (topTrades ?? [])
    .map((t) => {
      const name = (symbolMap && symbolMap.get(Number(t.symbol_id))) || `#${t.symbol_id}`;
      return name;
    })
    .filter((c, i, arr) => arr.indexOf(c) === i) // 去重
    .slice(0, 2);
  return coins.length ? `${coins.join("+")}赚` : "未知";
}

// observing 文件自带读写（不经 watchCandidates 的 {date,reason} schema）
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

// 近期精彩：topTrades（已 top-2 盈利）→ 用 symbolMap 解析币名（缺失回退 #<id>）
function resolveHighlights(topTrades, symbolMap, now) {
  return (Array.isArray(topTrades) ? topTrades : [])
    .slice(0, HIGHLIGHT_MAX)
    .map((t) => {
      const coin = symbolMap.get(Number(t.symbol_id)) || `#${t.symbol_id}`;
      const days = Math.max(0, Math.round((now - Number(t.updated_at)) / MS_PER_DAY));
      return `${coin} ${compactUsd(t.realized_pnl, true)}（${days}天前）`;
    });
}

/**
 * ⑧ watch-ready 质量复核：对首次 promote 地址按更严标准二次过滤（sodex 版阈值）。
 * @param {Array} scored - ④ 全量带分列表（含 walletAddress/activeDays/nTrades/maxLoss）
 * @param {Array} promoted - 本周首次 promote 的地址列表
 * @param {Map} symbolMap - symbol_id→币名映射
 * @returns {{watchReady:Array, needsMore:Array}}
 */
function filterWatchReady(scored, promoted, symbolMap) {
  const scoredMap = new Map(
    (scored ?? []).map((s) => [String(s.walletAddress ?? "").toLowerCase(), s]),
  );
  const g = WATCH_READY_SODEX;

  const watchReady = [];
  const needsMore = [];

  for (const p of promoted) {
    const full = scoredMap.get(p.address.toLowerCase());
    if (!full) {
      needsMore.push({ ...p, label: generateLabel([], symbolMap), reason: "缺少完整数据" });
      continue;
    }

    const failures = [];
    if (p.score < g.scoreMin) failures.push(`评分${p.score}<${g.scoreMin}`);
    if ((full.activeDays || 0) < g.activeDaysMin) failures.push(`活跃${full.activeDays}天<${g.activeDaysMin}`);
    if ((full.nTrades || 0) < g.nTradesMin) failures.push(`交易${full.nTrades}笔<${g.nTradesMin}`);
    if ((p.profitFactor || 0) < g.pfMin && p.profitFactor !== Infinity) failures.push(`PF${fmtRatio(p.profitFactor)}<${g.pfMin}`);

    // 单笔尾部风险：最大亏损不超过净利的 50%
    if ((full.maxLoss || 0) > (p.netProfit || 1) * g.maxLossRatio) {
      failures.push(`最大亏损占比过高`);
    }

    const label = generateLabel(p.topTrades, symbolMap);

    if (failures.length === 0) {
      watchReady.push({
        address: p.address,
        score: p.score,
        label,
        reason: `评分${p.score}·活跃${full.activeDays}天·${full.nTrades}笔·PF ${fmtRatio(p.profitFactor)}`,
      });
    } else {
      needsMore.push({
        address: p.address,
        score: p.score,
        label,
        reason: failures.join("; "),
        failures,
      });
    }
  }

  return { watchReady, needsMore };
}

// 构造 TG「观察态」消息（顺序 🟢→🔴→⚠️→🟡）。四段全空 → 返回 null（静默不推）
export function buildObservingTgMessage(decisions, dayLabel) {
  const { promoted, removed, retained = [], watching, watchReady = [], needsMoreObservation = [] } = decisions;
  if (!promoted.length && !removed.length && !retained.length && !watching.length) return null;
  const L = [`🔬 sodex 观察态 · ${dayLabel}`];

  if (promoted.length) {
    L.push("");
    L.push(`🟢 结算·升 watch（连续 ${PROMOTE_WEEKS} 周达标）`);

    if (watchReady.length) {
      L.push("");
      L.push("  ✅ 建议立即添加");
      watchReady.slice(0, MAX_LIST).forEach((p, i) => {
        L.push(`    #${i + 1} 📡 ${shortAddr(p.address)} 🏷️ ${p.label}`);
        L.push(`       ${p.reason}`);
      });
      if (watchReady.length > MAX_LIST) L.push(`    …另有 ${watchReady.length - MAX_LIST} 个建议添加`);
    }
    if (needsMoreObservation.length) {
      L.push("");
      L.push("  ⚠️ 已 promote 但未通过复核");
      needsMoreObservation.slice(0, MAX_LIST).forEach((p, i) => {
        L.push(`    #${i + 1} 📡 ${shortAddr(p.address)} 🏷️ ${p.label}`);
        L.push(`       原因: ${p.reason}`);
      });
      if (needsMoreObservation.length > MAX_LIST) L.push(`    …另有 ${needsMoreObservation.length - MAX_LIST} 个未通过`);
    }
  }
  if (removed.length) {
    L.push("");
    L.push(`🔴 本周移出（断 streak）`);
    removed.slice(0, MAX_LIST).forEach((r) => L.push(`  📡 ${shortAddr(r.address)} 上周评分${r.lastScore} · ${r.reason}`));
    if (removed.length > MAX_LIST) L.push(`  …另有 ${removed.length - MAX_LIST} 个移出`);
  }
  if (retained.length) {
    L.push("");
    L.push(`⚠️ 本周 API 错误暂留（下周重试）`);
    retained.slice(0, MAX_LIST).forEach((r) => L.push(`  📡 ${shortAddr(r.address)} 上周评分${r.lastScore} · ${r.reason}`));
    if (retained.length > MAX_LIST) L.push(`  …另有 ${retained.length - MAX_LIST} 个暂留`);
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
 * @param {Array} scored - ④打分全量带分列表（pre-topK，含 walletAddress/accountId/score/topTrades）
 * @param {Array} evalElim - ③淘汰逐址记录 {accountId,stage,reason}
 * @param {object} ctx - { dryRun, noPush, logDir, tgToken, tgChat, generatedAt:Date, excludeSet:Set }
 */
export async function observing(scored, evalElim, ctx) {
  try {
    const { dryRun, noPush, logDir, tgToken, tgChat, generatedAt, excludeSet } = ctx;
    const genDate = generatedAt instanceof Date ? generatedAt : new Date();
    const now = genDate.getTime();
    const weekId = isoWeekId(genDate);

    const observingPath = join(__dirname, "..", "..", "sodex-watch", "watch-observing.json");
    const obs = loadObserving(observingPath);
    const excl = new Set([...(excludeSet ?? [])].map((a) => String(a).toLowerCase()));

    // 本周合格集（∉watch ∉parked），按 walletAddress 小写归一
    const qualified = new Map();
    for (const s of scored ?? []) {
      const addr = String(s.walletAddress ?? "").toLowerCase();
      if (!addr || excl.has(addr)) continue;
      qualified.set(addr, s);
    }

    const promoted = [];
    const watching = [];
    const removed = [];
    const retained = []; // API transient 错误暂留（不断 streak）

    // 本周合格：续命 / 结算 / 新入
    for (const [addr, s] of qualified) {
      const entry = obs[addr];
      if (entry) {
        if (!Array.isArray(entry.weeksSeen)) entry.weeksSeen = [];
        if (!entry.weeksSeen.includes(weekId)) entry.weeksSeen.push(weekId); // ISO 周去重
        entry.lastScore = s.score;
        entry.apiRetries = 0; // 本周正常通过 → 清零 API 失败计数
        if (!entry.accountId) entry.accountId = s.accountId; // seed/迁移条目补 accountId
        if (entry.weeksSeen.length >= PROMOTE_WEEKS) {
          const isFirstPromotion = !entry.recommended;
          if (isFirstPromotion) {
            entry.recommended = true;
            promoted.push({
              address: addr, score: s.score, profitFactor: s.profitFactor, winRate: s.winRate,
              netProfit: s.netProfit, weeks: entry.weeksSeen.length, topTrades: s.topTrades,
            });
          } else if (entry.watchReady === false) {
            // 上次未通过复核，本周重新评估
            promoted.push({
              address: addr, score: s.score, profitFactor: s.profitFactor, winRate: s.winRate,
              netProfit: s.netProfit, weeks: entry.weeksSeen.length, topTrades: s.topTrades,
            });
          }
        }
      } else {
        obs[addr] = { since: weekId, weeksSeen: [weekId], recommended: false, lastScore: s.score, accountId: s.accountId, reason: "" };
        watching.push({ address: addr, score: s.score });
      }
    }

    // observing 里本周未出现：断 streak 移出（绝不 park）
    // transient API 错误做 grace period——保留不断 streak，连续 N 次失败才真移除
    const elimReason = new Map((evalElim ?? []).map((e) => [String(e.accountId ?? ""), e.reason]));
    for (const addr of Object.keys(obs)) {
      if (qualified.has(addr)) continue;
      // 已被人工移入 watch/parked（进排除集）→ 静默清出，不报 🔴（升级/归档非掉出）
      if (excl.has(addr)) {
        delete obs[addr];
        continue;
      }
      const entry = obs[addr];
      // sodex 口径：elimReason 按 accountId 索引
      let reason = elimReason.get(String(entry.accountId ?? "")) || "掉出榜单（pnl/量下滑）";
      if (isTransientApiError(reason)) {
        const retries = Number.isFinite(entry.apiRetries) && entry.apiRetries >= 0 ? entry.apiRetries : 0;
        if (retries < MAX_API_RETRIES - 1) {
          entry.apiRetries = retries + 1;
          retained.push({ address: addr, lastScore: entry.lastScore ?? "-", reason: reason.replace(/^画像拉取失败:\s*/, ""), apiRetries: retries + 1 });
          continue; // 保留，不断 streak
        }
        // 连续 MAX_API_RETRIES 次 API 失败 → 真移除
        reason = `连续${MAX_API_RETRIES}次API拉取失败: ${reason.replace(/^画像拉取失败:\s*/, "")}`;
      }
      removed.push({
        address: addr,
        lastScore: entry.lastScore ?? "-",
        reason,
      });
      delete obs[addr];
    }

    // 近期精彩需要 symbol_id→币名映射：仅有 🟢 时拉一次
    let symbolMap = new Map();
    if (promoted.length) {
      try { symbolMap = await refreshSymbols(); } catch { symbolMap = new Map(); }
    }
    for (const p of promoted) p.highlights = resolveHighlights(p.topTrades, symbolMap, now);

    const decisions = { promoted, removed, retained, watching };

    // ⑧ watch-ready 质量复核：对 promote 地址二次过滤
    if (promoted.length) {
      const { watchReady, needsMore } = filterWatchReady(scored, promoted, symbolMap);
      decisions.watchReady = watchReady;
      decisions.needsMoreObservation = needsMore;

      // 回写 entry.watchReady 供后续周重新评估
      for (const wr of watchReady) {
        const entry = obs[wr.address.toLowerCase()];
        if (entry) entry.watchReady = true;
      }
      for (const nm of needsMore) {
        const entry = obs[nm.address.toLowerCase()];
        if (entry) entry.watchReady = false;
      }
    }
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
    writeFileSync(join(obsDir, `observing-${stamp}.md`), msg ?? `🔬 sodex 观察态 · ${beijingDay(genDate)}\n\n本周无变动（无结算 / 无移出 / 无新观察）。`, "utf8");

    saveObserving(observingPath, obs);

    if (!noPush && msg) await sendTelegram(tgToken, tgChat, msg);

    return { promoted: promoted.length, watching: watching.length, removed: removed.length, promotedAddresses: promoted.map((p) => p.address) };
  } catch (e) {
    console.error(`⑥ observing 失败（不影响 ①-⑤）：${e.message}`);
    return null;
  }
}

export const __internals = { isoWeekId, buildObservingTgMessage, resolveHighlights, compactUsd, loadObserving, isTransientApiError, filterWatchReady, generateLabel };
