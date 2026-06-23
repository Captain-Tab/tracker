// ③ 输出 Output：log/ 结果文件(json+md) + TG 推送。绝不写 HYPE-watch/config。
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TG_TIMEOUT_MS = 8_000;
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

const pad2 = (n) => String(n).padStart(2, "0");
function localStamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}
function beijingDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e) { console.error(`TG 推送失败：${e.message}`); }
}

function buildTgMessage(ranked, summary, mdFileName, generatedAt, window) {
  const lines = [];
  lines.push(`🔭 HYPE 跟单候选（粗筛）`);
  lines.push(`⌚ ${beijingDate(generatedAt)} · 窗口 ${window}`);
  lines.push(`扫描 ${summary.scanned} → 过门槛 ${summary.passed} → 推荐 ${summary.recommended} · 排除 ${summary.excluded} 在监听`);

  if (!ranked.length) {
    lines.push("");
    lines.push(`📭 本轮无合格候选`);
    return lines.join("\n");
  }
  ranked.slice(0, DETAIL_CARDS).forEach((c, i) => {
    const m = c.perf[window];
    lines.push("");
    lines.push(`#${i + 1} · 📡 ${c.address}`);
    lines.push(`盈亏 ${fmtUsd(m.pnl)} · 量 ${fmtUsd(m.vlm)} · ROI ${fmtPct(m.roi)}`);
    lines.push(`账户净值 ${fmtUsd(c.accountValue)}`);
  });
  lines.push("");
  lines.push(`📄 详情 ${mdFileName}`);
  return lines.join("\n");
}

function buildMarkdown(ranked, summary, generatedAt, window, gate) {
  const lines = [];
  lines.push(`# HYPE 跟单候选（粗筛）· ${beijingDate(generatedAt)}`);
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
      lines.push(`### #${i + 1} · \`${c.address}\`${c.displayName ? ` · ${c.displayName}` : ""}`);
      lines.push(`- ${window}：盈亏 ${fmtUsd(m.pnl)} · 量 ${fmtUsd(m.vlm)} · ROI ${fmtPct(m.roi)}`);
      const a = c.perf.allTime;
      if (a) lines.push(`- allTime：盈亏 ${fmtUsd(a.pnl)} · 量 ${fmtUsd(a.vlm)}`);
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

  mkdirSync(logDir, { recursive: true });
  const mdPath = join(logDir, mdFileName);
  const jsonPath = join(logDir, `discovery-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: generatedAt.toISOString(), window, gate, summary, recommended: ranked }, null, 2), "utf8");
  writeFileSync(mdPath, md, "utf8");

  if (!noPush) await sendTelegram(tgToken, tgChat, buildTgMessage(ranked, summary, mdFileName, generatedAt, window));
  return { mdPath, jsonPath };
}

export const __internals = { buildTgMessage, buildMarkdown, localStamp };
