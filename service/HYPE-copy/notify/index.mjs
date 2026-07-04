// 跟单出口逻辑层：每动作 JSONL + journald（recordAction）/ 一轮一条汇总推送（pushRoundSummary）。
// 文案在 notify/templates.mjs（文案/逻辑分离）。两条管线独立：noop 不推但可记。
// token/chat 走跟单独立配置，绝不复用 watch token。
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, lineFor } from "./templates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "log");
const TG_TIMEOUT_MS = 8_000;
// 持续性告警（同状态每轮重现）：进入推一次，靠指纹去重防刷屏。
// v3：删 skip-maxpos/skip-capped，加 skip-no-open / alert（编排告警：top-N 未跟 / 认栽封顶）。
// would-defend 是动作非告警，正常推不去重。
const ALERT_RESULTS = new Set(["skip-unmappable", "skip-mindust", "skip-no-open", "skip-no-price", "alert"]);

const ts = () => new Date().toISOString().slice(11, 19);

// result → JSONL action（总纲 04 schema）：v3 加 would-defend 归 defend；skip 类归 skip。
function actionOf(result) {
  if (result === "place" || result === "ok") return "place";
  if (result === "would-defend") return "defend";
  if (result === "min-capital") return "min-capital";
  if (result === "failed" || result === "error") return "error";
  return "skip"; // skip-unmappable / skip-mindust / skip-no-open / skip-no-price / noop
}

// 订单 side(buy/sell) → 持仓方向 long/short
function sideToDir(side) {
  if (side === "buy") return "long";
  if (side === "sell") return "short";
  return "";
}

// toLogLine(ActionResult) → CopyLogLine（每动作一条，字段对齐总纲 04 schema + 计时）
export function toLogLine(a) {
  const result = a.result ?? a.decision ?? "ok";
  return {
    ts: a.ts ?? Date.now(),
    targetId: String(a.targetId ?? ""),
    action: actionOf(result),
    coin: String(a.coin ?? ""),
    side: sideToDir(a.side),
    size: String(a.size ?? "0"),
    refPx: String(a.refPx ?? ""),
    fillPx: String(a.fillPx ?? a.refPx ?? ""), // dry-run would-fill 估算价 = refPx
    fee: String(a.fee ?? "0"), // dry-run 估算，缺失落 "0"
    slippageBps: Number(a.slippageBps ?? 0),
    fullMs: Number(a.fullMs ?? 0), // 完整时间 t2−t0（本轮拉取→完成）
    execMs: Number(a.execMs ?? 0), // 执行时间 t2−t1（copy 处理段）
    dryRun: a.dryRun === true,
    result,
    reason: String(a.reason ?? ""),
    ...(a.szDecimals != null ? { szDecimals: Number(a.szDecimals) } : {}),
    ...(a.positionNotional != null ? { positionNotional: String(a.positionNotional) } : {}),
    ...(a.maxPosNotional != null ? { maxPosNotional: String(a.maxPosNotional) } : {}),
  };
}

// journald：systemd StandardOutput=journal 路由 stdout/stderr；level 随 action 分级。
// 注：repo 既有服务均 console→journald（无 pino 依赖）；pino 可后续替换。
function journalLog(line) {
  const payload = JSON.stringify(line);
  if (line.action === "error") console.error(ts(), "[copy:error]", payload);
  else if (line.action === "skip" || line.action === "cap-warn") console.warn(ts(), "[copy:warn]", payload);
  else console.log(ts(), "[copy:info]", payload);
}

// JSONL 同步追加：HYPE-copy-<target>-<date>.jsonl（本地日，跨日自动滚新文件）。
export function appendJsonl(targetId, line, { dir = LOG_DIR } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const file = join(dir, `HYPE-copy-${targetId}-${date}.jsonl`);
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, JSON.stringify(line) + "\n");
  return file;
}

// recordAction：每动作一条 JSONL + journald（始终记录，与推送去重无关）。
export function recordAction(a, opts) {
  const line = toLogLine(a);
  appendJsonl(line.targetId, line, opts);
  journalLog(line);
  return line;
}

// 跟单 TG 推送（复用 watch 的 Bot API 模式；token/chat 跟单独立配置，物理分离）
export async function sendTelegram(token, chatId, text) {
  if (!token || !chatId || !text) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e) { console.error(ts(), `跟单 TG 推送失败：${e.message}`); }
}

// pushRoundSummary：一轮一条汇总（header + 多行明细 + 页脚），lines 为空则不推（去重铁律）。
// 返回是否推送，便于单测/上层判断。token/chat 空 → sendTelegram 内部静默不推。
export async function pushRoundSummary(headerLine, lines, footerLine, { token, chat } = {}) {
  const body = (lines ?? []).filter(Boolean);
  if (body.length === 0) return { pushed: false };
  const text = [headerLine, ...body, footerLine].filter(Boolean).join("\n");
  await sendTelegram(token, chat, text);
  return { pushed: true, text };
}

// 决定某事件是否进推送行 + 维护本轮告警指纹（纯函数，便于单测）。
// noop 不推；持续告警进入推一次（上轮已推则静默）；min-capital 仅锚定轮（wasFollowing=false）；place/error 直推。
export function decidePushLine(ev, { lastAlertFp, wasFollowing, newAlertFp } = {}) {
  const result = ev.result;
  if (result === "noop") return null;
  const line = lineFor(ev);
  if (!line) return null;
  if (ALERT_RESULTS.has(result)) {
    const key = `${ev.coin}:${result}`;
    if (newAlertFp) newAlertFp.add(key);
    return lastAlertFp?.has(key) ? null : line;
  }
  if (result === "min-capital") return wasFollowing ? null : line;
  return line;
}

export { escapeHtml };
