// 接口收口：所有 HTTP 接口 + WS 订阅声明集中于此，其余阶段文件只 import 调用，不散落 URL。
// 零依赖（Node18 内置 fetch），全链路 public 只读（无鉴权，同 query-account.mjs）。
// 自带轻量限流（并发≤4 + 每请求小间隔 + 429/409 退避），与 watch-account.mjs 限流单例隔离。

const BASE_DATA = "https://mainnet-data.sodex.dev";

const REQUEST_TIMEOUT_MS = 10_000; // 单请求超时
const CONCURRENCY = 4; // 全局并发上限（所有阶段共享此 gate）
const MIN_INTERVAL_MS = 120; // 相邻请求最小启动间隔，平滑 QPS
const MAX_RETRIES = 6; // 429/409 限流最大重试次数
const THROTTLE_STATUSES = new Set([429, 409]); // 409 为本网关实测限流码

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 大整数安全解析：account_id / position_id 等 16+ 位数字转字符串，规避 Number 精度丢失（同 watch）
function parseJsonSafe(text) {
  const guarded = text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(guarded);
}

// Retry-After 解析：纯秒数 或 HTTP-date；无法解析返回 null（由调用方回退指数退避）
function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(headerVal);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// 指数退避：2→4→8…封顶 60s，± 20% jitter
function backoffMs(attempt) {
  const base = Math.min(2 ** (attempt + 1), 60) * 1000;
  return Math.round(base + base * 0.2 * (Math.random() * 2 - 1));
}

// 全局并发 gate：最多 CONCURRENCY 个请求同时在飞，且相邻启动间隔 ≥ MIN_INTERVAL_MS
let activeCount = 0;
const waiters = [];
let lastStartAt = 0;

function scheduleWaiters() {
  while (activeCount < CONCURRENCY && waiters.length) {
    activeCount += 1;
    const resolve = waiters.shift();
    resolve();
  }
}

async function acquireSlot() {
  await new Promise((resolve) => {
    waiters.push(resolve);
    scheduleWaiters();
  });
  const now = Date.now();
  const wait = Math.max(0, lastStartAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await sleep(wait);
  lastStartAt = Date.now();
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  scheduleWaiters();
}

async function fetchWithRetry(url, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? parseJsonSafe(text) : null;
    } catch {
      json = { __nonJson: text };
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${url}`);
      err.status = res.status;
      err.body = json;
      err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      throw err;
    }
    return json;
  } catch (err) {
    if (THROTTLE_STATUSES.has(err.status) && attempt < MAX_RETRIES) {
      const waitMs = err.retryAfterMs ?? backoffMs(attempt);
      await sleep(waitMs);
      return fetchWithRetry(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 公共 GET：经全局限流 gate + 超时 + 大整数安全解析 + 429/409 退避重试。
 * @param {string} url - 完整请求 URL
 * @returns {Promise<unknown>} - 解析后的 JSON（16+ 位整数已转字符串）
 */
export async function httpGetJson(url) {
  await acquireSlot();
  try {
    return await fetchWithRetry(url, 0);
  } finally {
    releaseSlot();
  }
}

/**
 * 排行榜（漏斗入口，便宜）：拉头部账户。
 * @param {"24H"|"7D"|"30D"|"ALL_TIME"} windowType - 榜单窗口
 * @param {number} page - 页码（从 1 起）
 * @param {number} [pageSize=50] - 每页条数（后端上限 50）
 * @returns {Promise<{ total:number, items:Array<{wallet_address:string,account_id:string,pnl_usd:number,volume_usd:number,rank:number}> }>}
 *   - total: 榜单总数；items: 当前页条目（account_id 为字符串以防精度丢失）
 */
export async function fetchLeaderboard(windowType, page, pageSize = 50) {
  const url = `${BASE_DATA}/api/v1/leaderboard?window_type=${encodeURIComponent(windowType)}&sort_by=pnl&sort_order=desc&page=${page}&page_size=${pageSize}`;
  const json = await httpGetJson(url);
  const data = json?.data ?? {};
  return { total: Number(data.total ?? 0), items: Array.isArray(data.items) ? data.items : [] };
}

/**
 * PNL 概览（真伪鉴别，便宜）：PNL 分项构成。
 * @param {string} accountId - 账户 id（字符串，避免大整数精度问题）
 * @param {"7D"|"30D"|"90D"|"1Y"} window - 统计窗口
 * @returns {Promise<{total_pnl_usd:number,perps_closed_pnl_usd:number,spot_pnl_usd:number,perps_unrealized_pnl_usd:number,volume_usd:number,net_deposit_usd:number,roi:number}>}
 *   - perps_closed_pnl_usd: 合约逐笔已实现盈亏（门槛核心，D2 用绝对额）；net_deposit_usd: 净入金（反空投信号）
 */
export async function fetchOverview(accountId, window) {
  const url = `${BASE_DATA}/api/v1/wallet/portfolio/overview?account_id=${encodeURIComponent(accountId)}&window=${encodeURIComponent(window)}`;
  const json = await httpGetJson(url);
  return json?.data ?? {};
}

/**
 * PNL 曲线（稳定性画像，贵）：每日 pnl 序列。
 * @param {string} accountId - 账户 id
 * @param {"7D"|"30D"|"90D"|"1Y"} window - 窗口（chart 上限 90 天）
 * @returns {Promise<Array<{ts_ms:number,pnl_usd:number,perps_pnl_usd?:number}>>}
 *   - 每日点：pnl_usd 含现货浮盈；perps_pnl_usd 为纯合约日盈亏（freshness 用）
 */
export async function fetchChart(accountId, window) {
  const url = `${BASE_DATA}/api/v1/wallet/portfolio/chart?account_id=${encodeURIComponent(accountId)}&window=${encodeURIComponent(window)}`;
  const json = await httpGetJson(url);
  const data = json?.data ?? {};
  // 兼容 data.chart[] 或 data[] 两种返回形态
  if (Array.isArray(data.chart)) return data.chart;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * 平仓历史（逐笔真账本，贵）。
 * @param {string} accountId - 账户 id
 * @param {number} [limit=200] - **D1 必带**：默认只返 40 条，page/size/offset 全部无效，靠 limit 拿全
 * @returns {Promise<Array<{position_id:string,size:number,realized_pnl:number,created_at:number,updated_at:number,position_side:number}>>}
 *   - 平仓记录：size=0 为已平仓；realized_pnl 为权威已实现盈亏
 */
export async function fetchPositions(accountId, limit = 200) {
  const url = `${BASE_DATA}/api/v1/perps/positions?account_id=${encodeURIComponent(accountId)}&limit=${limit}`;
  const json = await httpGetJson(url);
  return Array.isArray(json?.data) ? json.data : [];
}

// ---------- WS 声明（discovery 本身不调用，仅作整个跟单系统接口收口备查）----------
// watch-account.mjs 用 wss://mainnet-gw.sodex.dev/ws/perps 订阅以下频道，user=address，无鉴权。
// 列在此处便于跟单系统接口单点维护；discovery 是离线批处理，不建立长连。
export const WS_PERPS = {
  url: "wss://mainnet-gw.sodex.dev/ws/perps",
  channels: ["accountState", "accountUpdate", "accountOrderUpdate", "accountTrade"],
  paramKey: "user", // 订阅入参 user=address
  auth: false,
};

export const __internals = { parseJsonSafe, parseRetryAfter, backoffMs, BASE_DATA };
