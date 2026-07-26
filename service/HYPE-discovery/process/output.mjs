// ③ 输出 Output：log/ 结果文件(json+md) + TG 推送。绝不写 HYPE-watch/config。
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sendWithRetry, sendDocumentWithRetry } from "../../lib/notify.mjs";
const DETAIL_CARDS = 5; // 前 5 名详展，超出 TG 不展示

function fmtUsd(value, signed = false) {
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : signed && x > 0 ? "+" : "";
  return `${sign}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(ratio) {
  const x = Number(ratio);
  if (!Number.isFinite(x)) return "-";
  return `${(x * 100).toFixed(1)}%`;
}

// 盈亏比 / 恢复比：Infinity（无亏损/无回撤）显示 ∞
function fmtRatio(v) {
  if (v === Infinity) return "∞";
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(2) : "-";
}

const pad2 = (n) => String(n).padStart(2, "0");
function localStamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}
function beijingDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  const r = await sendWithRetry(token, chatId, text);
  if (!r.ok) console.error(`TG 推送失败：${r.error}`);
}

// 上传 .md 文件到 Telegram（点击即下载）
async function sendTelegramDocument(token, chatId, filePath, caption) {
  if (!token || !chatId) return;
  const r = await sendDocumentWithRetry(token, chatId, filePath, caption);
  if (!r.ok) console.error(`TG 文件推送失败：${r.error}`);
}

function buildTgMessage(ranked, summary, generatedAt, window) {
  const lines = [];
  lines.push(`🔭 HYPE 跟单候选发现`);
  lines.push(`⌚ ${beijingDate(generatedAt)} · 窗口 ${window}`);
  lines.push(`扫描 ${summary.scanned} → 过门槛 ${summary.passed} → 推荐 ${summary.recommended} · 排除 ${summary.excluded} 在监听`);

  if (!ranked.length) {
    lines.push("");
    lines.push(`📭 本轮无合格候选`);
    return lines.join("\n");
  }
  ranked.slice(0, DETAIL_CARDS).forEach((c, i) => {
    lines.push("");
    lines.push(`#${i + 1} · 评分 ${c.score} · 📡 ${c.address}`);
    lines.push(`盈亏比 ${fmtRatio(c.profitFactor)} · 胜率 ${fmtPct(c.winRate)} · ${c.tradesPerDay.toFixed(1)} 笔交易/天`);
    lines.push(`净额 ${fmtUsd(c.netProfit)} · 中位单笔 ${fmtUsd(c.medTradePnl)} · ${c.nTrades} 笔`);
  });
  lines.push("");
  lines.push(`📄 完整报告见附件`);
  return lines.join("\n");
}

function buildMarkdown(ranked, summary, generatedAt, window, gate) {
  const lines = [];
  lines.push(`# HYPE 跟单候选发现 · ${beijingDate(generatedAt)}`);
  lines.push("");
  lines.push(`- 主窗口 **${window}** · 门槛 pnl≥${fmtUsd(gate.minPnl)} & vlm≥${fmtUsd(gate.minVlm)}`);
  lines.push(`- 扫描 **${summary.scanned}** → 过门槛 **${summary.passed}** → 推荐 **${summary.recommended}** · 排除已监听 ${summary.excluded} · topK=${summary.topK}${summary.truncated ? ` · 截断 ${summary.truncated}` : ""}`);
  lines.push("");
  if (!ranked.length) {
    lines.push(`📭 本轮无合格候选。`);
  } else {
    lines.push(`## 推荐名单`);
    ranked.forEach((c, i) => {
      const m = c.perf[window];
      lines.push("");
      lines.push(`### #${i + 1} · 评分 ${c.score} · \`${c.address}\`${c.displayName ? ` · ${c.displayName}` : ""}`);
      lines.push(`- 深评（交易级，已聚合 fill）：盈亏比 ${fmtRatio(c.profitFactor)} · 胜率 ${fmtPct(c.winRate)} · 恢复比 ${fmtRatio(c.recoveryFactor)} · ${c.tradesPerDay.toFixed(1)} 笔交易/天`);
      lines.push(`- 已实现：净额 ${fmtUsd(c.netProfit)} · ${c.nTrades} 笔交易（${c.nFills} 个 fill）· 中位单笔 ${fmtUsd(c.medTradePnl)} · 活跃 ${c.activeDays} 天${c.capped ? "（近期 2000 fill，全史未覆盖）" : ""}`);
      if (c.truePnl !== undefined) lines.push(`- 真实 PnL：${fmtUsd(c.truePnl, true)}（净额 ${fmtUsd(c.netProfit, true)} + 资金费 ${fmtUsd(c.fundingTotal, true)}）`);
      lines.push(`- 下注规模（名义）：中位 ${fmtUsd(c.medNotional)} · 最大 ${fmtUsd(c.maxNotional)}`);
      lines.push(`- ${window} 榜：盈亏 ${fmtUsd(m.pnl)} · 量 ${fmtUsd(m.vlm)} · ROI ${fmtPct(m.roi)}（充提污染，仅参考）`);
      lines.push(`- 账户净值：${fmtUsd(c.accountValue)}`);
    });
  }
  return lines.join("\n");
}

/**
 * 产出结果。
 * @param {Array} ranked - filter 产出的 topK 候选
 * @param {object} ctx - { summary, generatedAt:Date, dryRun, noPush, logDir, tgToken, tgChat, window, gate }
 * @returns {Promise<{mdPath:string|null, jsonPath:string|null}>}
 */
export async function output(ranked, ctx) {
  const { summary, generatedAt, dryRun, noPush, logDir, tgToken, tgChat, window, gate } = ctx;
  const stamp = localStamp(generatedAt);
  const mdFileName = `discovery-${stamp}.md`;
  const md = buildMarkdown(ranked, summary, generatedAt, window, gate);

  if (dryRun) {
    console.log("\n" + md + "\n");
    return { mdPath: null, jsonPath: null };
  }

  const discoveryDir = join(logDir, "discovery");
  mkdirSync(discoveryDir, { recursive: true });
  const mdPath = join(discoveryDir, mdFileName);
  const jsonPath = join(discoveryDir, `discovery-${stamp}.json`);
  // 剔除 trades（逐笔明细仅内存供 ⑥ 用），防 json 日志膨胀
  const recommendedForJson = ranked.map(({ trades, ...rest }) => rest);
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: generatedAt.toISOString(), window, gate, summary, recommended: recommendedForJson }, null, 2), "utf8");
  writeFileSync(mdPath, md, "utf8");

  if (!noPush) {
    await sendTelegram(tgToken, tgChat, buildTgMessage(ranked, summary, generatedAt, window));
    await sendTelegramDocument(tgToken, tgChat, mdPath, `HYPE 跟单候选报告 · ${beijingDate(generatedAt)}`);
  }
  return { mdPath, jsonPath };
}

export const __internals = { buildTgMessage, buildMarkdown, localStamp };
