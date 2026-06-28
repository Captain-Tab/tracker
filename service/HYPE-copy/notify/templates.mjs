// 跟单推送纯文案模板（与逻辑分离）。仅字符串构造 + 事件分类，无 IO、无状态。
// 精度比较走 precision.mjs（禁裸 parseFloat）；HTML 文案经 escapeHtml（sendTelegram 用 parse_mode HTML）。
import { absStr, gt, lt, eq, signOf } from "../process/precision.mjs";

// 事件 icon（用户确认集）
const ICON = {
  open: "🆕", add: "⏫", reduce: "⏬", close: "🏁",
  start: "▶", stop: "⏹", skip: "⛔", minCap: "💡", error: "⚠️",
};
const DIR_CN = { long: "多", short: "空", "": "" };

// HTML 转义：reason 等自由文案含 < > & 时防破坏 parse_mode HTML 解析
export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 短地址（notify 自洽，不跨 service import）
const shortAddr = (a) => (typeof a === "string" && a.length >= 10 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a ?? "?");

// 仓位方向：size 符号 → long/short（precision，禁裸 Number 比较）
const posDir = (size) => (signOf(String(size ?? "0")) < 0 ? "short" : "long");

// ratio(number) → 百分比字符串（display；用 precision.mul 避免裸浮点）
import { mul } from "../process/precision.mjs";
const fmtRatioPct = (r) => `${mul(String(r), "100")}%`;

// 消息头：每条汇总首行
export function buildHeader(targetId, targetAddr, subAccount) {
  const sub = subAccount ? ` → ${subAccount}` : "";
  return `[DRY-RUN] 🎯${targetId}｜跟 ${shortAddr(targetAddr)}${sub}`;
}

// 镜像变化分类：由上一轮 prevSize 与本轮 newSize 的量级派生（总纲事件分类表）
export function classifyMirrorEvent(prevSize, newSize) {
  const p = absStr(prevSize ?? "0");
  const n = absStr(newSize ?? "0");
  if (eq(p, "0") && gt(n, "0")) return "open";
  if (eq(n, "0") && gt(p, "0")) return "close";
  if (gt(n, p)) return "add";
  if (lt(n, p)) return "reduce";
  return "same";
}

// lineFor(action) → 明细行字符串 | null（noop / same → null = 不出行）
export function lineFor(a) {
  const result = a.result ?? a.decision ?? "ok";
  const coin = a.coin;
  switch (result) {
    case "noop":
      return null;
    case "place":
    case "ok": {
      const ev = classifyMirrorEvent(a.currentSize, a.desiredSize);
      const dir = DIR_CN[posDir(ev === "close" ? a.currentSize : a.desiredSize)];
      const px = a.refPx;
      const held = absStr(a.desiredSize ?? "0");
      const delta = absStr(a.deltaSize ?? a.size ?? "0");
      const ratioText = a.ratio != null ? `（ratio ${fmtRatioPct(a.ratio)}）` : "";
      if (ev === "open") return `${ICON.open} 开 ${coin} ${dir} ${held} @ ${px}${ratioText}`;
      if (ev === "add") return `${ICON.add} 加 ${coin} ${dir} +${delta} → 持 ${held} @ ${px}`;
      if (ev === "reduce") return `${ICON.reduce} 减 ${coin} ${dir} -${delta} → 持 ${held} @ ${px}`;
      if (ev === "close") return `${ICON.close} 平 ${coin} ${dir}（目标已清仓）`;
      return null; // same
    }
    case "skip-unmappable":
      return `${ICON.skip} ${coin} 无 hype 映射，跳过（不计入分母）`;
    case "skip-mindust":
      return `${ICON.skip} ${coin} 名义 < 最小名义($10)，跳过`;
    case "skip-no-price":
      return `${ICON.skip} ${coin} 无价格数据，本轮跳过`;
    case "skip-maxpos":
      return `${ICON.skip} ${coin} 单仓超上限，封顶拦截加仓部分`;
    case "skip-capped":
      return `${ICON.skip} 已达资金上限(MAX_DEPLOY_PCT)，无法完全跟仓 ${coin}`;
    case "min-capital":
      return `${ICON.minCap} 推荐最低本金=${a.minCapital}，可跟 ${a.canFollowCoins ?? "-"}`;
    case "failed":
    case "error":
      return `${ICON.error} ${coin} 执行失败 — ${escapeHtml(a.reason ?? "未知")}`;
    default:
      return null;
  }
}

// 启动（待锚定，目标无可映射仓时）
export function lineStart(extra = "") {
  return `${ICON.start} 跟单启动${extra ? `（${extra}）` : ""}`;
}

// 启动 + 初始镜像同步（重启首轮，不逐仓当开仓洪水）：positions=[{coin,size}]
export function lineInitialSync(positions) {
  const list = (positions ?? [])
    .map((p) => `持 ${p.coin} ${DIR_CN[posDir(p.size)]} ${absStr(p.size ?? "0")}`)
    .join(" / ");
  return `${ICON.start} 跟单启动 + 初始镜像同步：${list || "无可映射仓"}`;
}

// 关闭跟单（进程 SIGTERM/SIGINT）
export function lineStop() {
  return `${ICON.stop} 跟单关闭`;
}

// 计时页脚
export function buildFooter(execMs, fullMs) {
  return `⏱ 执行 ${execMs}ms｜完整 ${fullMs}ms`;
}
