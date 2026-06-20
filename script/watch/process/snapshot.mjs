// Snapshot 模式（单地址；按需 + 每日定时）：REST 拉快照渲染推送，不建 WS 长连。
import { fmtTime, pickAt, formatDisplayId } from "../../tool/format.mjs";
import { parseWsPosition, parseReduceOnlyOrders } from "./parse.mjs";
import { buildEventBanner, renderPositions, renderPositionHistory, buildTgMessage } from "./render.mjs";
import {
  log, httpGetJson, fetchPositionHistory, resolveAccountIdViaChain, sendTelegram,
  THROTTLE_STATUSES, SEEN_IDS_CAP,
} from "../api/index.mjs";

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

export function msUntilNextShanghai(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const now = Date.now();
  const sh = new Date(now + SHANGHAI_OFFSET_MS);
  let target = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), h, m, 0) - SHANGHAI_OFFSET_MS;
  if (target <= now) target += 24 * 3600 * 1000;
  return target - now;
}

export class SnapshotMode {
  constructor(env, address, flags) {
    this.env = env; this.address = address; this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
    this.at = pickAt(flags.at, undefined); // 非法 --at 回退默认 20:00
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.label = flags.label ?? null;
    this.seenPositionIds = new Set();
    this.baselineLogged = false;
    this.lastPositions = [];
    this.timer = null;
    this.running = false;
  }

  makeDisplayId() { return formatDisplayId(this.address, this.label); }

  async start() {
    await this.fetchAndReport("启动快照");
    this.scheduleDaily();
    process.on("SIGUSR1", () => this.fetchAndReport("按需快照"));
    if (process.stdin.isTTY) { process.stdin.setEncoding("utf8"); process.stdin.on("data", () => this.fetchAndReport("按需快照")); log(`按需抓取：终端回车，或 kill -USR1 ${process.pid}`); }
    else log(`按需抓取：kill -USR1 ${process.pid}`);
  }

  scheduleDaily() { const ms = msUntilNextShanghai(this.at); this.timer = setTimeout(async () => { await this.fetchAndReport(`每日快照 ${this.at}`); this.scheduleDaily(); }, ms); log(`下次每日抓取：${this.at} 上海时间（约 ${Math.round(ms / 60000)} 分钟后）`); }

  async fetchSnapshot() {
    const stateJson = await httpGetJson(`${this.env.gateway}/api/v1/perps/accounts/${this.address}/state`);
    const data = stateJson?.data ?? stateJson ?? {};
    const positions = Array.isArray(data.P) ? data.P.map(parseWsPosition) : [];
    const ordersRaw = Array.isArray(data.O) ? data.O : [];
    let accountId = this.accountId ?? data.aid ?? data.accountId ?? data.account_id ?? null;
    if (!accountId) accountId = await resolveAccountIdViaChain(this.env, this.address);
    this.accountId = accountId;
    return { positions, ordersRaw, accountId };
  }

  async fetchAndReport(reason) {
    if (this.running) return;
    this.running = true;
    try {
      const snap = await this.fetchSnapshot();
      if (!snap.accountId) { log("无法解析 accountId，跳过"); return; }
      let result = null;
      try { result = await fetchPositionHistory(this.env, snap.accountId); }
      catch (err) {
        log(`[平仓历史拉取失败] ${err.message}`);
        // 快照模式低频（定时/按需），限流时直接跳过本次，等下次触发
        if (THROTTLE_STATUSES.has(err.status)) log(`触发限流(${err.status})，跳过本次快照`);
      }
      // 拉取失败：不渲染空数据
      if (result === null) { log("拉取失败，跳过本次快照上报"); return; }

      const records = result.records ?? [];
      const reduceOnly = parseReduceOnlyOrders(snap.ordersRaw);
      const newPosIds = new Set();
      for (const r of records) { if (!this.seenPositionIds.has(r.positionId)) { this.seenPositionIds.add(r.positionId); if (this.baselineLogged) newPosIds.add(r.positionId); } }
      if (this.seenPositionIds.size > SEEN_IDS_CAP) this.seenPositionIds = new Set(records.map((r) => r.positionId));
      this.baselineLogged = true;
      this.lastPositions = snap.positions;
      const clock = fmtTime();
      const displayId = this.makeDisplayId();

      console.log("\n" + buildEventBanner(displayId, "SNAPSHOT", clock));
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(snap.positions, reduceOnly));
      const histText = renderPositionHistory(records, newPosIds, this.historyLimit);
      console.log("\n--- 平仓历史 Position History ---"); console.log(histText ?? "  （无平仓记录）");
      if (this.flags.raw && result?.raw) { console.log("\n--- raw positions ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      const tgText = buildTgMessage(displayId, "SNAPSHOT", clock, snap.positions, reduceOnly, records, newPosIds, this.historyLimit);
      sendTelegram(this.tgToken, this.tgChat, tgText);
    } catch (e) { log(`快照失败：${e.message}`); }
    finally { this.running = false; }
  }

  close() { if (this.timer) clearTimeout(this.timer); }
}
