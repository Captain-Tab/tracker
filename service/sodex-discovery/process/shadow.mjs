// ⑦ shadow 影子跟踪：discovery ⑥ observing 后同进程运行，维护预测台账 log/ledger.json。
// 纯采集不校准（闭环反馈阶段 1）：(A) 写预测 recommended+observing🟢 / (A') 写对照 scored 排名外 / (B) 回填推荐后真实盈亏。
// 只写 ledger 一个文件；不推 TG、不落 md。异常由 main.mjs 的 try/catch 捕获，不中断 ①-⑥。
// sodex 口径（区别于 HYPE 的 userFills+aggregateTrades）：盈亏用 fetchPositions(accountId,limit) 拉逐笔已平仓位，
// filter(size===0 && updated_at>recommendedAt) → Σrealized_pnl；台账行双键 address(walletAddress)+accountId。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPositions } from "../api/index.mjs";
import { __internals as observingInternals } from "./observing.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { isoWeekId } = observingInternals; // 复用 observing 的 ISO 周实现，避免两份漂移

const MS_PER_WEEK = 7 * 86_400_000;
const MATURE_WEEKS = 4; // 满 4 周冻结停跟
const DEFAULT_POSITIONS_LIMIT = 1000; // ctx 未注入时兜底（对齐 config.positionsLimit）
const PREDICT_FIELDS = ["score", "profitFactor", "winRate", "recoveryFactor", "netProfit"];

// 台账自带读写（同 observing 富 schema 模式；读失败容错 {}）
function loadLedger(path) {
  try {
    const o = JSON.parse(readFileSync(path, "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
function saveLedger(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

// 只取 predict 侧五个指标（Infinity 经 JSON 序列化为 null，阶段 2 calibrate 容忍）
function pickPredict(o) {
  const out = {};
  for (const k of PREDICT_FIELDS) out[k] = o?.[k];
  return out;
}

// 按 updated_at 升序累计 realized_pnl 峰谷最大回撤（正值；照 metrics.mjs 已平仓位口径），落账时取负
function computeMaxDrawdown(positions) {
  const ordered = [...positions].sort((a, b) => Number(a.updated_at) - Number(b.updated_at));
  let cum = 0, peak = 0, maxDD = 0;
  for (const p of ordered) {
    cum += Number(p.realized_pnl);
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }
  return maxDD;
}

const lc = (a) => String(a ?? "").toLowerCase();

// 统一建行：sodex 地址字段是 walletAddress（非 .address！），双键必带 accountId
function mkRow(s, stage) {
  return { ...pickPredict(s), address: lc(s.walletAddress), accountId: s.accountId, stage };
}

// scored: 全量带分画像（含 walletAddress+accountId+五指标）；ranked: 本周 recommended（=scored 前 topK）；promotedAddrs: observing🟢 地址（小写 walletAddress）
export async function shadow(scored, ranked, promotedAddrs, ctx) {
  const now = (ctx?.generatedAt instanceof Date ? ctx.generatedAt : new Date()).getTime();
  const weekId = isoWeekId(new Date(now));
  const logDir = ctx?.logDir ?? join(__dirname, "..", "log");
  const ledgerPath = join(logDir, "ledger.json");
  const positionsLimit = ctx?.positionsLimit ?? DEFAULT_POSITIONS_LIMIT;
  const ledger = loadLedger(ledgerPath);

  const safeScored = Array.isArray(scored) ? scored : [];
  const safeRanked = Array.isArray(ranked) ? ranked : [];
  const promoted = Array.isArray(promotedAddrs) ? promotedAddrs : []; // observing 异常返回 null 时兜底

  // (A) 写预测：recommended 腿直接用 ranked（含 walletAddress+accountId+recoveryFactor）
  const predictRows = safeRanked.map((s) => mkRow(s, "discovery"));
  // observing🟢 腿：promoted 只给 address(小写 walletAddress)，回查 scored 补全（recoveryFactor + accountId）
  for (const addr of promoted) {
    const a = lc(addr);
    const s = safeScored.find((x) => lc(x.walletAddress) === a); // 按 walletAddress 匹配，非 .address
    if (s) predictRows.push(mkRow(s, "observing"));
  }
  // (A') 写对照：ranked.length 边界后的 N 个（N=recommended 数）；ranked=scored.slice(0,topK) 故与推荐组天然不重叠
  const N = safeRanked.length;
  const control = safeScored.slice(safeRanked.length, safeRanked.length + N);
  for (const s of control) predictRows.push(mkRow(s, "control"));

  // 落账去重（同 week|address 只写一次；discovery/observing 先于 control，同址以前者为准）
  let recorded = 0;
  for (const r of predictRows) {
    if (!r.address) continue;
    const id = `${weekId}|${r.address}`;
    if (ledger[id]) continue;
    ledger[id] = {
      week: weekId,
      recommendedAt: now,
      address: r.address,
      accountId: r.accountId,
      stage: r.stage,
      predict: pickPredict(r),
      outcome: { baselinePnl: r.netProfit ?? 0, pnlSince: {}, tradesSince: {}, maxDrawdownSince: {}, lastPulledAt: null, matured: false },
    };
    recorded += 1;
  }

  // (B) 回填「跟踪中」行（未成熟且满 2 周）：重拉推荐后已平仓位，算推荐后盈亏
  let backfilled = 0, matured = 0;
  for (const id of Object.keys(ledger)) {
    const row = ledger[id];
    if (!row?.outcome || row.outcome.matured) continue;
    const weeksElapsed = Math.round((now - row.recommendedAt) / MS_PER_WEEK);
    if (weeksElapsed < 2) continue; // 未满 2 周无桶可写
    const bucket = weeksElapsed >= MATURE_WEEKS ? "4w" : "2w";

    let positions = [];
    try {
      positions = await fetchPositions(row.accountId, positionsLimit); // sodex 用 accountId + limit，走全局限流
    } catch {
      positions = []; // 销户/无数据/网络抖动 → 空，不报错
    }
    // 已平仓(size===0) 且 推荐后平仓(updated_at>recommendedAt)
    const postClosed = (Array.isArray(positions) ? positions : []).filter(
      (p) => Number(p.size) === 0 && Number(p.updated_at) > row.recommendedAt,
    );

    row.outcome.pnlSince[bucket] = postClosed.reduce((sum, p) => sum + Number(p.realized_pnl), 0); // 休眠(0仓)→0，不误判负样本
    row.outcome.tradesSince[bucket] = postClosed.length; // 已平仓位数
    row.outcome.maxDrawdownSince[bucket] = -computeMaxDrawdown(postClosed); // 负值，识别回本型陷阱
    row.outcome.lastPulledAt = now;
    backfilled += 1;
    if (weeksElapsed >= MATURE_WEEKS) {
      row.outcome.matured = true; // 满 4 周冻结停跟
      matured += 1;
    }
  }

  if (!ctx?.dryRun) saveLedger(ledgerPath, ledger); // dry-run 不写台账（对齐 output/observing）
  console.log(`⑦ 影子跟踪：记账 ${recorded} 条 · 回填 ${backfilled} 条 · 成熟 ${matured} 条${ctx?.dryRun ? "（dry-run 未写盘）" : ""}`);
  return { recorded, backfilled, matured };
}
