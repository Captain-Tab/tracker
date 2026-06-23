// ⑤ 输出 Output：log/ 结果文件(json+md) + TG 推送。绝不写 watch.config。
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TG_TIMEOUT_MS = 8_000;
const DETAIL_CARDS = 5; // 前 5 名详展卡片，超出部分不展示（TG 手机端紧凑格式易混淆）

// ---------- 格式化（discovery 自包含，不依赖 watch-account.mjs）----------
function fmtUsd(value, signed = false) {
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : signed && x > 0 ? "+" : "";
  return `${sign}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(ratio) {
  const x = Number(ratio);
  if (!Number.isFinite(x)) return "-";
  return `${(x * 100).toFixed(0)}%`;
}

function fmtPF(pf) {
  if (pf === Infinity) return "∞";
  const x = Number(pf);
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(2);
}

// TG 消息中完整展示钱包地址（不再截断）

function profileType(p, config) {
  return p.nTrades >= config.gates.minTrades ? "中频稳健型" : "低频精准型";
}

const pad2 = (n) => String(n).padStart(2, "0");

// 本地时间戳：YYYY-MM-DD-HHmm（文件名用）
function localStamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

// 北京日期 YYYY-MM-DD（TG 头部用）
function beijingDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function windowsStr(hitWindows) {
  return Array.from(hitWindows).join("+") || "-";
}

// ---------- Telegram ----------
async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error(`TG 推送失败：${e.message}`);
  }
}

// 手机友好排版：逐行短文本，每指标独占一行，避免窄屏折行
function buildTgMessage(ranked, summary, mdFileName, generatedAt, config) {
  const lines = [];
  // 标题与时间分行，避免日期干扰标题语义
  lines.push(`🔭 跟单候选发现`);
  lines.push(`⌚ ${beijingDate(generatedAt)}`);
  lines.push(`候选 ${summary.candidates} → 通过 ${summary.passed} → 推荐 ${summary.recommended}`);
  lines.push(`排除 ${summary.excluded} 个在监听 · 不足 topK 不凑数`);

  if (!ranked.length) {
    lines.push("");
    lines.push(`📭 本周无合格候选（候选 ${summary.candidates} → 通过 0）`);
    return lines.join("\n");
  }

  // TG 仅展示前 5 名详展卡片，第 6 起不展示（紧凑单行在手机端易混淆）
  const display = ranked.slice(0, DETAIL_CARDS);
  display.forEach((p, i) => {
    const n = i + 1;
    lines.push("");
    lines.push(`#${n} · 评分 ${p.score} · ${profileType(p, config)}`);
    lines.push(`📡 ${p.walletAddress}`);
    lines.push(`盈亏比 ${fmtPF(p.profitFactor)}`);
    lines.push(`胜率 ${fmtPct(p.winRate)}`);
    lines.push(`合约盈利 ${fmtUsd(p.perpsPnl)}`);
    lines.push(`成交量 ${fmtUsd(p.volume)}`);
    lines.push(`命中窗 ${windowsStr(p.hitWindows)}`);
  });

  lines.push("");
  lines.push(`📄 详情 ${mdFileName}`);
  return lines.join("\n");
}

// ---------- 人读 markdown（比 TG 更全）----------
function buildMarkdown(ranked, summary, eliminated, generatedAt, config) {
  const lines = [];
  lines.push(`# 跟单候选发现结果 · ${beijingDate(generatedAt)}`);
  lines.push("");
  lines.push(`- 候选 **${summary.candidates}** → 通过 **${summary.passed}** → 推荐 **${summary.recommended}**`);
  lines.push(`- 扫描榜单条目 ${summary.scanned} · 排除已监听 ${summary.excluded} 个 · riskPreset=${config.riskPreset}`);
  lines.push(`- topK=${config.topK}（上限，合格不足不凑数）`);
  lines.push("");

  if (!ranked.length) {
    lines.push(`📭 本周无合格候选。`);
  } else {
    lines.push(`## 推荐名单`);
    ranked.forEach((p, i) => {
      lines.push("");
      lines.push(`### #${i + 1} · 评分 ${p.score} · ${profileType(p, config)}`);
      lines.push(`- 地址：\`${p.walletAddress}\`（account_id=${p.accountId}）`);
      lines.push(`- 盈亏比：${fmtPF(p.profitFactor)} · 胜率：${fmtPct(p.winRate)}`);
      lines.push(`- 合约盈利：${fmtUsd(p.perpsPnl)} · 成交量：${fmtUsd(p.volume)}`);
      lines.push(`- 恢复比 RF：${Number.isFinite(p.recoveryFactor) ? p.recoveryFactor.toFixed(2) : "∞"} · 最大回撤：${fmtUsd(p.maxDD)} · 近90D净额：${fmtUsd(p.netProfit)}`);
      lines.push(`- 最大单笔盈利：${fmtUsd(p.maxWin)} · 最大单笔亏损：${fmtUsd(-p.maxLoss)}（爆仓比 ${Number.isFinite(p.blowupRatio) ? p.blowupRatio.toFixed(2) : "∞"}）`);
      lines.push(`- 平均持仓：${p.avgHoldMin.toFixed(0)} 分钟 · 近90D笔数：${p.nTrades} · 活跃跨度：${p.activeDays}天`);
      lines.push(`- 命中窗：${windowsStr(p.hitWindows)}`);
    });
  }

  lines.push("");
  lines.push(`## 淘汰摘要（${eliminated.length}）`);
  const byStage = { filter: [], evaluate: [] };
  for (const e of eliminated) (byStage[e.stage] ?? (byStage[e.stage] = [])).push(e);
  for (const [stage, list] of Object.entries(byStage)) {
    if (!list.length) continue;
    lines.push("");
    lines.push(`### ${stage}（${list.length}）`);
    for (const e of list) lines.push(`- account_id=${e.accountId}：${e.reason}`);
  }

  return lines.join("\n");
}

// 序列化画像（hitWindows Set→Array，Infinity→null 由 JSON.stringify 处理）
function serializeProfile(p) {
  return {
    ...p,
    hitWindows: Array.from(p.hitWindows),
    profitFactor: Number.isFinite(p.profitFactor) ? p.profitFactor : null,
    recoveryFactor: Number.isFinite(p.recoveryFactor) ? p.recoveryFactor : null,
    blowupRatio: Number.isFinite(p.blowupRatio) ? p.blowupRatio : null,
  };
}

/**
 * 产出结果。
 * @param {Array} ranked - score 产出的 topK
 * @param {object} ctx - { summary, eliminated, generatedAt:Date, dryRun:boolean, noPush:boolean, logDir:string, tgToken:string|null, tgChat:string|null }
 * @param {object} config - effectiveConfig
 * @returns {Promise<{mdPath:string|null, jsonPath:string|null, md:string}>}
 */
export async function output(ranked, ctx, config) {
  const { summary, eliminated, generatedAt, dryRun, noPush, logDir, tgToken, tgChat } = ctx;
  const stamp = localStamp(generatedAt);
  const mdFileName = `discovery-${stamp}.md`;
  const jsonFileName = `discovery-${stamp}.json`;

  const md = buildMarkdown(ranked, summary, eliminated, generatedAt, config);

  // dry-run：只 stdout 打印 md 详情，不落盘、不推 TG
  if (dryRun) {
    console.log("\n" + md + "\n");
    return { mdPath: null, jsonPath: null, md };
  }

  mkdirSync(logDir, { recursive: true });
  const mdPath = join(logDir, mdFileName);
  const jsonPath = join(logDir, jsonFileName);

  const jsonPayload = {
    generatedAt: generatedAt.toISOString(),
    config,
    summary,
    recommended: ranked.map(serializeProfile),
    eliminated,
  };
  writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");
  writeFileSync(mdPath, md, "utf8");

  if (!noPush) {
    const tgText = buildTgMessage(ranked, summary, mdFileName, generatedAt, config);
    await sendTelegram(tgToken, tgChat, tgText);
  }

  return { mdPath, jsonPath, md };
}

export const __internals = { buildTgMessage, buildMarkdown, profileType, localStamp };
