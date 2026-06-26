// IO 层：Hyperliquid leaderboard（非官方 stats 域名，GET 全量）+ info（备用）。
// 自包含，fetch 走 WARP 代理。
import { installFetchProxy } from "../../lib/WARP/index.mjs";

await installFetchProxy();

export const ENVS = {
  production: {
    info: "https://api.hyperliquid.xyz/info",
    leaderboard: "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard",
  },
};

// leaderboard 实测 32MB / 8-22s 不稳定，超时给足；失败抛错由 main 跳过本轮
const LEADERBOARD_TIMEOUT_MS = 40_000;

export const log = (msg) => console.log(msg);

// ---------- info 接口封装 + 限流 gate（并发≤4 + 间隔 + 429/503 退避，复用 sodex-discovery 模式）----------
const INFO_URL = ENVS.production.info;
const REQUEST_TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;          // info 全局并发上限
const MIN_INTERVAL_MS = 120;    // 相邻请求最小启动间隔，平滑 QPS
const MAX_RETRIES = 6;          // 429/503 限流最大重试
const THROTTLE_STATUSES = new Set([429, 503]); // Hyperliquid 限流/不可用

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 指数退避：2→4→8…封顶 60s，± 20% jitter
function backoffMs(attempt) {
  const base = Math.min(2 ** (attempt + 1), 60) * 1000;
  return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
}

let activeCount = 0;
const waiters = [];
let lastStartAt = 0;
function scheduleWaiters() {
  while (activeCount < CONCURRENCY && waiters.length) { activeCount += 1; waiters.shift()(); }
}
async function acquireSlot() {
  await new Promise((resolve) => { waiters.push(resolve); scheduleWaiters(); });
  const wait = Math.max(0, lastStartAt + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastStartAt = Date.now();
}
function releaseSlot() { activeCount = Math.max(0, activeCount - 1); scheduleWaiters(); }

// POST info（带超时）；429/503 走退避重试，其余 HTTP 错误抛出
async function postInfoWithRetry(body, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(INFO_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!res.ok) {
      if (THROTTLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        clearTimeout(timer); await sleep(backoffMs(attempt));
        return postInfoWithRetry(body, attempt + 1);
      }
      const err = new Error(`HTTP ${res.status} info ${body.type}`); err.status = res.status; throw err;
    }
    return res.json();
  } finally { clearTimeout(timer); }
}

// info 统一入口（经全局限流 gate）
async function postInfo(body) {
  await acquireSlot();
  try { return await postInfoWithRetry(body, 0); }
  finally { releaseSlot(); }
}

// 当前持仓 + 账户保证金（marginSummary.totalMarginUsed / assetPositions[].position.marginUsed/unrealizedPnl）
export const fetchClearinghouseState = (address) => postInfo({ type: "clearinghouseState", user: address });
// 逐笔成交（含 closedPnl / fee / dir / time），单次上限 2000 笔
export const fetchUserFills = (address) => postInfo({ type: "userFills", user: address });
// 按时间翻页拿历史成交（单次仍 2000 上限，startTime 递增翻页）。
// startTime 为 0/null/undefined 时回退到 fetchUserFills——HYPE API 的 userFillsByTime 在 startTime=0
// 时可能返回截断数据（实测某帐号漏了近 7 天 200 条 fill），无时间过滤的 userFills 更可靠。
export const fetchUserFillsByTime = (address, startTime) =>
  startTime
    ? postInfo({ type: "userFillsByTime", user: address, startTime })
    : fetchUserFills(address);
// 资金费历史（startTime 起；逐条 delta.usdc 正=净收/负=净付），用于真实 PnL 修正（不在 closedPnl 内）
export const fetchUserFunding = (address, startTime) => postInfo({ type: "userFunding", user: address, startTime });

// 流式逐行提取器：喂入文本片段，吐出花括号配对完整的 row JSON 子串。
// 不缓存完整 32MB 文本——只在 buf 里留"尚未配对完整的尾巴"，把内存峰值压到几十 MB。
// 状态机：跳过头部直到 leaderboardRows 的 `[`，之后按 brace 深度 + 字符串态抽 row（字符串内的 {}/" 不计）。
export function createRowScanner() {
  let buf = "";
  let started = false; // 是否已越过 "leaderboardRows":[

  return {
    push(chunk) {
      buf += chunk;
      const rows = [];

      if (!started) {
        const key = buf.indexOf('"leaderboardRows"');
        if (key === -1) { if (buf.length > 1 << 16) buf = buf.slice(-32); return rows; } // 头部还没到，防 buf 膨胀
        const bracket = buf.indexOf("[", key);
        if (bracket === -1) return rows;
        buf = buf.slice(bracket + 1);
        started = true;
      }

      // 每次整体重扫：状态全为局部，buf 始终从对象边界（或分隔符）起，重扫廉价且无跨 push 计数漂移。
      let depth = 0, inString = false, escape = false, objStart = -1, lastEnd = -1;
      for (let i = 0; i < buf.length; i++) {
        const ch = buf[i];
        if (inString) {
          if (escape) escape = false;
          else if (ch === "\\") escape = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "{") { if (depth === 0) objStart = i; depth++; }
        else if (ch === "}") {
          depth--;
          if (depth === 0 && objStart !== -1) { rows.push(buf.slice(objStart, i + 1)); lastEnd = i; objStart = -1; }
        }
      }
      // 保留尾部：未闭合 row 从 objStart 起；否则丢弃已消费部分（最后一个完整 row 之后）
      if (objStart !== -1) buf = buf.slice(objStart);
      else if (lastEnd !== -1) buf = buf.slice(lastEnd + 1);
      return rows;
    },
  };
}

// 流式拉取 leaderboard，每个 row（已 JSON.parse）回调 onRow。失败抛错（由 main 跳过本轮）。
// onRow 抛错会中断；onRow 返回 false 可提前停止（如 --limit）。
export async function streamLeaderboardRows(env, onRow) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEADERBOARD_TIMEOUT_MS);
  try {
    const res = await fetch(env.leaderboard, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) { const err = new Error(`HTTP ${res.status} leaderboard`); err.status = res.status; throw err; }
    if (!res.body) throw new Error("leaderboard 无响应体流");
    const scanner = createRowScanner();
    const decoder = new TextDecoder("utf-8");
    let count = 0;
    for await (const chunk of res.body) {
      const text = decoder.decode(chunk, { stream: true });
      for (const rowJson of scanner.push(text)) {
        let row;
        try { row = JSON.parse(rowJson); } catch { continue; } // 单行解析失败跳过该行，不整体崩
        count++;
        if (onRow(row) === false) { return count; } // early-stop：return 触发 async iterator 自动取消 stream，不 abort（abort 会抛 AbortError 被误当采集失败）
      }
    }
    return count;
  } finally { clearTimeout(timer); }
}
