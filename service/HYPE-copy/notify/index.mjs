// 跟单出口：实时推送（独立跟单 TG）+ 每动作 JSONL + journald。消费 03 动作结果（ActionResult）。
// 三出口分工（总纲 04）：推送（执行视角，noop 去重不推）/ JSONL（每动作一条可回溯）/ 统计（process/stats.mjs）。
// 推送与日志两条管线独立：noop 不推但可记。token/chat 走跟单独立配置，绝不复用 watch token。
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "log");
const TG_TIMEOUT_MS = 8_000;

const ts = () => new Date().toISOString().slice(11, 19);

// 短地址（与 tool/format 同口径，notify 自洽不跨 service import）
const shortAddr = (a) => (typeof a === "string" && a.length >= 10 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a ?? "?");

// result → JSONL action（总纲 04 schema）：skip-capped 归 cap-warn，其余 skip/noop 归 skip。
function actionOf(result) {
  if (result === "place" || result === "ok") return "place";
  if (result === "skip-capped") return "cap-warn";
  if (result === "min-capital") return "min-capital";
  if (result === "failed" || result === "error") return "error";
  return "skip"; // skip-unmappable / skip-mindust / skip-maxpos / noop
}

// 订单 side(buy/sell) → 持仓方向 long/short（dry-run current 恒空 → buy=开多/sell=开空）
function sideToDir(side) {
  if (side === "buy") return "long";
  if (side === "sell") return "short";
  return "";
}

// toLogLine(ActionResult) → CopyLogLine（每动作一条，字段对齐总纲 04 schema）
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
    dryRun: a.dryRun === true,
    result,
    reason: String(a.reason ?? ""),
  };
}

const DIR_CN = { long: "多", short: "空", "": "" };

// buildActionText(ActionResult) → string | null。noop（delta=0 / |delta|<阈值）返回 null = 不推（去重铁律）。
export function buildActionText(a) {
  const result = a.result ?? a.decision ?? "ok";
  const id = a.targetIdLabel ?? shortAddr(a.targetId) ?? a.targetId;
  const ratioText = a.ratio != null ? `，ratio=${a.ratio}` : "";

  switch (result) {
    case "noop":
      return null; // 去重：碎步 / 无变动不推
    case "place":
    case "ok": {
      const dir = DIR_CN[sideToDir(a.side)] || (a.side ?? "");
      return `[DRY-RUN] 跟单 ${id}：${a.coin} ${dir} ${a.size} @ ${a.refPx}${ratioText}`;
    }
    case "skip-unmappable":
      return `[DRY-RUN] ${id}：${a.coin} 无 hype 映射，跳过（不计入分母）`;
    case "skip-mindust":
      return `[DRY-RUN] ${id}：${a.coin} 名义 < 最小名义($10)，跳过`;
    case "skip-no-price":
      return `[DRY-RUN] ${id}：${a.coin} 无价格数据，本轮跳过`;
    case "skip-maxpos":
      return `[DRY-RUN] ${id}：${a.coin} 单仓超上限，封顶拦截加仓部分`;
    case "skip-capped":
      return `[DRY-RUN] ${id}：已达资金上限(MAX_DEPLOY_PCT)，无法完全跟仓 ${a.coin}`;
    case "min-capital":
      return `[DRY-RUN] ${id}：推荐最低本金=${a.minCapital}，当前可跟 ${a.canFollowCoins ?? "-"}`;
    case "failed":
    case "error":
      return `[DRY-RUN] ${id}：${a.coin} 执行失败 — ${a.reason ?? "未知"}`;
    default:
      return null;
  }
}

// journald：systemd StandardOutput=journal 路由 stdout/stderr；level 随 result 分级
// （place/ok=info→stdout，skip/cap-warn=warn→stderr，error/failed=error→stderr）。
// 注：repo 既有服务均 console→journald（无 pino 依赖）；pino 可后续替换，不为 dry-run 引重依赖。
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

// notifyAction：两条独立管线——文案非空则推送；JSONL + journald 始终记录（noop 不推但可记）。
export async function notifyAction(a, { token, chat } = {}) {
  const line = toLogLine(a);
  appendJsonl(line.targetId, line);
  journalLog(line);
  const text = buildActionText(a);
  if (text) await sendTelegram(token, chat, text);
  return { pushed: !!text, line };
}
