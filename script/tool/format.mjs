// 全局共享格式化 / 校验工具（数字千分位+去尾零 / USD / 百分比 / 时间 / 地址 / HH:MM）。
// 纯函数，零依赖，供 watch / discovery / query 复用；console / TG 两端共用同一口径。

// ---------- 地址 / HH:MM 校验 ----------
export function isAddress(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

// 短地址：前 4 位(含 0x)...后 4 位（如 0x58...7027）
export function shortAddress(address) {
  if (!address || typeof address !== "string" || address.length < 10) return address ?? "?";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// banner 头 id：默认【短地址】；有 label 时🎯 label（如【0x58...7027】🎯 xiao）
export function formatDisplayId(address, label) {
  const head = `【${shortAddress(address)}】`;
  return label ? `${head} 🎯 ${label}` : head;
}

// 每日快照时间格式校验：HH:MM（0-23 : 0-59）。config / CLI 写错时不致定时器失效。
export function isValidHHMM(v) {
  if (typeof v !== "string") return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

// 每日快照时间取值优先级：地址项 at > CLI --at > 默认 20:00；非法值跳过回退下一级。
export function pickAt(watchAt, cliAt) {
  if (isValidHHMM(watchAt)) return watchAt;
  if (isValidHHMM(cliAt)) return cliAt;
  return "20:00";
}

// ---------- 统一格式化工具（千分位 + 去尾零，console / TG 两端共用）----------
// 空值判定：null / undefined / "" → 缺失（显示 "-"，不当 0）
export const isBlank = (v) => v === null || v === undefined || v === "";

// 数字：千分位 + 最多 maxDecimals 位小数，尾部 0 自动删减（toLocaleString 默认 trim）；缺失/非有限 → "-"
export function fmtNum(value, maxDecimals = 2) {
  if (isBlank(value)) return "-";
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  return x.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

// USD 金额：负号在 $ 前（-$0.26）；signed 时正数加 +；缺失/非有限 → "-"
export function fmtUsd(value, signed = false) {
  if (isBlank(value)) return "-";
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : signed && x > 0 ? "+" : ""; // 0 不带符号
  return `${sign}$${fmtNum(Math.abs(x), 2)}`;
}

// 百分比：带符号（+/-），2 位去尾零；缺失/非有限 → "-"
export function fmtPct(value) {
  if (isBlank(value)) return "-";
  const x = Number(value);
  if (!Number.isFinite(x)) return "-";
  const sign = x < 0 ? "-" : x > 0 ? "+" : ""; // 0 不带符号
  return `${sign}${fmtNum(Math.abs(x), 2)}%`;
}

// 统一事件时间：YYYY/MM/DD HH:mm:ss（上海 UTC+8）；入参 ms 时间戳，缺省取当前
export function fmtTime(tsMs) {
  const d = tsMs == null ? new Date() : new Date(Number(tsMs));
  if (Number.isNaN(d.getTime())) return "-";
  // sv-SE → "2026-06-18 10:45:48"，仅日期段是 "-"（时间段用 ":"），全替换为 "/"
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/-/g, "/");
}

// 平仓历史精简时间：MM/DD HH:mm（去年份/秒，省横向宽度，降低手机折行）
export function fmtTimeShort(tsMs) {
  const full = fmtTime(tsMs);
  return full === "-" ? "-" : full.slice(5, 16);
}

// 方向中文映射（仓位方向只有 LONG / SHORT / BOTH，BOTH 已在 positionDirection 按符号判定）
const DIRECTION_CN = { LONG: "做多", SHORT: "做空" };
export const directionCN = (dir) => DIRECTION_CN[dir] ?? dir;
