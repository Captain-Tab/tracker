// 有状态编排层：HYPE WS 连接生命周期 + 聚焦频道监听 + 去抖触发 + REST 拉取聚合 + 推送。
// 仓位取自 WS clearinghouseState 快照；离场单/平仓在变化时用 info REST 拉取。
import { fmtTime, fmtNum, pickAt, formatDisplayId } from "../../tool/format.mjs";
import {
  parsePositions, parseExitOrders, parseCloseRecords,
  canonicalPositionsFp, canonicalOpenOrdersFp, positionKeysFp, canonicalExitOrdersFp,
  diffPositions, diffExitOrders, pricePrecisionOf,
} from "./parse.mjs";
import {
  classifyBanner, buildEventBanner, buildExitEventBanner, renderPositions, renderCloseHistory,
  buildTgMessage, buildPositionChangeMessage, buildCloseMessage, buildExitOrderMessage,
  derivePositionView, exitOrderLine,
} from "./render.mjs";
import { reportSkipReason } from "../../tool/reportGate.mjs";
import {
  log, parseJsonSafe, fetchFrontendOpenOrders, fetchUserFills, fetchClearinghouseState, sendTelegram,
  enterSharedRateLimit, nextSharedBackoffMs, resetSharedBackoff, watcherRegistry,
  sharedRateLimitUntil, THROTTLE_STATUSES, SEEN_IDS_CAP, szDecimalsOf,
} from "../api/index.mjs";
import { installWsProxy } from "../../lib/WARP/index.mjs";
import { writeSignal } from "../../lib/copy-signal/index.mjs";
import { loadLastPositions, saveLastPositions } from "../../tool/lastPositionsStore.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CHANNELS = ["clearinghouseState", "openOrders", "userFills", "orderUpdates"];
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function msUntilNextShanghai(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const now = Date.now();
  const sh = new Date(now + SHANGHAI_OFFSET_MS);
  let target = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), h, m, 0) - SHANGHAI_OFFSET_MS;
  if (target <= now) target += 24 * 3600 * 1000;
  return target - now;
}

try {
  await installWsProxy();
} catch {
  console.error("需要安装 ws 包:\n  npm install ws");
  process.exit(1);
}

// 一组离场单变化的聚合动作：全同一动作则用之，混合回退 mixed。
function aggregateExitAction(entries) {
  const actions = new Set(entries.map((e) => e.action));
  return actions.size === 1 ? [...actions][0] : "mixed";
}

export class AccountWatcher {
  constructor(env, address, flags) {
    this.env = env;
    this.address = address;
    this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
    // 短档：开/平/反手/离场单等结构变化即时推（沿用原值）
    this.debounceMs = Number(flags["debounce-ms"] ?? 3000);
    this.maxWaitMs = Number(flags["max-wait-ms"] ?? 5000);
    // 长档：同仓滚仓加减仓（仅 size 变）合并，治理刷屏。HYPE 实测拐点 12s；设为与短档相同即回退原行为。
    this.tierDebounceMs = Number(flags["tier-debounce-ms"] ?? 12000);
    this.tierMaxWaitMs = Number(flags["tier-max-wait-ms"] ?? 45000);
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.label = flags.label ?? null;
    this.at = pickAt(flags.at, undefined);
    this.isNew = flags.isNew !== false; // START 门控：缺省 true（单地址 CLI 不门控）
    this.forceReport = false;
    this.dailyTimer = null;
    this.tgReason = "event";
    this.ws = null;
    this.requestId = 0;
    this.reconnectAttempt = 0;
    this.pingTimer = null;
    this.pongTimer = null;
    this.debounceTimer = null;
    this.firstPendingAt = 0;
    this.closing = false;
    this.fetching = false;
    this.positions = [];      // 来自 WS clearinghouseState（归一模型）
    this.marginSummary = null; // { accountValue, totalMarginUsed, totalNtlPos }
    this.withdrawable = null;
    this.wsOrders = [];       // 来自 WS openOrders（仅指纹用）
    this.lastPositions = [];
    this.prevExitOrders = new Map(); // oid → 离场单（离场单变化 diff 基线）
    this.seenCloseOids = new Set();
    this.baselineLogged = false;
    this.stateFp = null;
    this.lastOutFp = null;
    // 跟单事件信号（可选，加法）：copy-signal-path 未配则全程 no-op，watch 行为 diff=0
    this.copySignalPath = flags["copy-signal-path"] ?? null;
    this.copySignalSeq = 0;
    // 仓位状态持久化（08-position-persistence §2.1）：重启从磁盘恢复 lastPositions，不丢基线
    this.stateDir = flags["state-dir"] ?? null;
    // 分档 debounce：与上次推送的"持仓键集合 / 离场单子集"比对判结构变化；
    // pendingStructural = 当前 debounce 窗口内是否出现结构变化（只升不降，取最紧急）。
    // 初值 null 表示"从未推送过"，使首帧 baseline（含空仓）必判结构变化 → 短档即时推 START WATCH。
    this.lastKeysFp = null;
    this.lastExitFp = null;
    this.pendingStructural = false;
  }

  makeDisplayId() { return formatDisplayId(this.address, this.label); }

  start() { watcherRegistry.add(this); this.connect(); }

  connect() {
    log(`连接 ${this.env.ws}（无鉴权）`);
    const ws = new WebSocket(this.env.ws);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      log("OPEN，订阅账户频道");
      for (const channel of CHANNELS) this.send({ method: "subscribe", subscription: { type: channel, user: this.address } });
      this.startPing();
      this.scheduleDaily();
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = (ev) => { this.clearTimers(); if (this.closing) return; log(`CLOSE code=${ev.code}，准备重连`); this.scheduleReconnect(); };
    ws.onerror = (ev) => log("WS ERROR:", ev?.message || ev?.type || ev);
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  startPing() {
    this.clearTimers();
    this.pingTimer = setInterval(() => { this.send({ method: "ping" }); this.pongTimer = setTimeout(() => { log("pong 超时，断开重连"); try { this.ws?.close(); } catch {} }, PONG_TIMEOUT_MS); }, PING_INTERVAL_MS);
  }

  clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.pingTimer = null; this.pongTimer = null; this.dailyTimer = null;
  }

  scheduleReconnect() {
    const exp = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    const delay = Math.round(exp + exp * 0.2 * (Math.random() * 2 - 1));
    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }

  scheduleDaily() {
    const ms = msUntilNextShanghai(this.at);
    this.dailyTimer = setTimeout(() => { this.forceReport = true; this.lastOutFp = null; this.tgReason = "daily"; this.scheduleFetch(true); this.scheduleDaily(); }, ms);
    log(`下次每日镜像：${this.at} 上海时间（约 ${Math.round(ms / 60000)} 分钟后）`);
  }

  handleMessage(raw) {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    let msg;
    try { msg = parseJsonSafe(typeof raw === "string" ? raw : String(raw)); } catch { return; }
    const ch = msg.channel;
    if (ch === "pong") return;
    if (ch === "subscriptionResponse") { return; }
    if (ch === "error") { log(`订阅错误：${JSON.stringify(msg.data).slice(0, 120)}`); return; }

    if (ch === "clearinghouseState") {
      const cs = msg.data?.clearinghouseState ?? msg.data ?? {};
      this.positions = parsePositions(cs.assetPositions, szDecimalsOf);
      this.marginSummary = cs.marginSummary ?? null;
      this.withdrawable = cs.withdrawable != null ? Number(cs.withdrawable) : null;
      this.recomputeStateFp();
      return;
    }
    if (ch === "openOrders") {
      this.wsOrders = Array.isArray(msg.data?.orders) ? msg.data.orders : [];
      this.recomputeStateFp();
      return;
    }
    // 成交 / 订单推送只作"重新评估"提示，状态以 REST 全量为准；
    // 无持仓上下文，不改变档位（structural=false，pendingStructural 只升不降）。
    if (ch === "userFills" || ch === "orderUpdates") this.scheduleFetch(false);
  }

  recomputeStateFp() {
    // 触发指纹保持全量挂单（灵敏度不变）；档位判别另用键集合 + 离场单子集。
    const fp = canonicalPositionsFp(this.positions) + "|" + canonicalOpenOrdersFp(this.wsOrders);
    // 结构变化（开仓/平仓/反手 → 键集合变；离场单挂改撤 → 离场单子集变）相对上次推送 → 短档即时；
    // 仅 abs(size)/开仓单 sz 变（滚仓加减仓）→ 长档合并。
    const structural = positionKeysFp(this.positions) !== this.lastKeysFp
      || canonicalExitOrdersFp(this.wsOrders) !== this.lastExitFp;
    if (fp !== this.stateFp) { this.stateFp = fp; this.emitCopySignal(); this.scheduleFetch(structural); }
  }

  // 跟单脏标信号（加法）：未配 copySignalPath → no-op；写失败不影响 watch 主流程
  emitCopySignal() {
    if (!this.copySignalPath) return;
    try {
      writeSignal(this.copySignalPath, { seq: ++this.copySignalSeq, ts: Date.now(), address: this.address });
    } catch (e) { log(`[copy-signal] 写失败（不影响监听）：${e.message}`); }
  }

  scheduleFetch(structural = false) {
    if (Date.now() < sharedRateLimitUntil) return;
    if (structural) this.pendingStructural = true; // 只升级，取窗口最紧急档
    const now = Date.now();
    if (this.firstPendingAt === 0) this.firstPendingAt = now;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // 分档：结构变化（开/平/反手/离场单）走短档即时；滚仓走长档合并。
    const debounceMs = this.pendingStructural ? this.debounceMs : this.tierDebounceMs;
    const maxWaitMs = this.pendingStructural ? this.maxWaitMs : this.tierMaxWaitMs;
    const waited = now - this.firstPendingAt;
    if (waited >= maxWaitMs) { this.flushFetch(); return; }
    const delay = Math.min(debounceMs, maxWaitMs - waited);
    this.debounceTimer = setTimeout(() => this.flushFetch(), delay);
  }

  flushFetch() {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.firstPendingAt = 0;
    // pendingStructural 不在此重置——推送成功后才随基准一起清，避免 fetch 重入丢失紧急度。
    this.fetchAndReport();
  }

  async fetchAndReport() {
    if (this.fetching) { this.scheduleFetch(this.pendingStructural); return; }
    if (Date.now() < sharedRateLimitUntil) return;
    this.fetching = true;
    try {
      let exitOrders = null;
      let closeRecords = null;
      try {
        const [frontOrders, fills] = await Promise.all([
          fetchFrontendOpenOrders(this.env, this.address),
          fetchUserFills(this.env, this.address),
        ]);
        exitOrders = parseExitOrders(frontOrders);
        closeRecords = parseCloseRecords(fills);
        resetSharedBackoff();
      } catch (err) {
        log(`[REST 拉取失败] ${err.message}`);
        if (THROTTLE_STATUSES.has(err.status)) {
          const waitMs = err.retryAfterMs ?? nextSharedBackoffMs();
          enterSharedRateLimit(waitMs);
          log(`触发限流(${err.status})，${Math.round(waitMs / 1000)}s 后全员恢复`);
        }
        return; // 拉取失败：不渲染空数据，保留指纹待下次成功
      }

      // 出参去重：仓位 + 离场单 + 平仓 oid 集
      const exitFp = exitOrders.map((o) => `${o.oid}:${o.price}:${o.size}`).sort().join(",");
      const closedFp = closeRecords.map((r) => r.oid).sort().join(",");
      const outFp = canonicalPositionsFp(this.positions) + "|" + exitFp + "|" + closedFp;
      const force = this.forceReport; this.forceReport = false;
      if (!force && outFp === this.lastOutFp) return;
      this.lastOutFp = outFp;

      const events = diffPositions(this.lastPositions, this.positions);
      // 保证金/量级变化需“变化前”仓位：推进 lastPositions 前快照 prev（events 已基于其算出）
      const prevPositions = this.lastPositions;
      this.lastPositions = this.positions;
      // 推进档位判定基准（仅确认推送时推进，去重/限流 return 不动）：下次以本次状态为对照判结构变化。
      this.lastKeysFp = positionKeysFp(this.positions);
      this.lastExitFp = canonicalExitOrdersFp(this.wsOrders);
      this.pendingStructural = false;

      // 首帧基线全部不标；之后新出现的平仓 oid 标 ★
      const newOids = new Set();
      for (const r of closeRecords) { if (!this.seenCloseOids.has(r.oid)) { this.seenCloseOids.add(r.oid); if (this.baselineLogged) newOids.add(r.oid); } }
      if (this.seenCloseOids.size > SEEN_IDS_CAP) this.seenCloseOids = new Set(closeRecords.map((r) => r.oid));
      const isBaseline = !this.baselineLogged;

      // Layer 2: 首帧用 REST clearinghouseState 交叉验证（08-position-persistence §2.2）
      // 纠正 HL WS 重连时可能返回的不完整快照 + 检测 downtime 仓位变化
      if (isBaseline && this.stateDir) {
        const persisted = loadLastPositions(this.stateDir, this.address);
        if (persisted.length > 0) {
          try {
            const cs = await fetchClearinghouseState(this.env, this.address);
            const restPositions = parsePositions(cs?.assetPositions, szDecimalsOf);
            log(`[REST 兜底] 持久化 ${persisted.length} 个仓位，REST 返回 ${restPositions.length} 个仓位`);
            // 以 REST 权威数据为准，用持久化数据作为 diff 基线检测 downtime 变化
            this.positions = restPositions;
            this.lastPositions = persisted; // 关键：保留持久化基线，用于 diff 产生 CLOSED/OPENED
          } catch (e) {
            log(`[REST 兜底] clearinghouseState REST 失败(${e.message})，降级到持久化数据`);
            this.lastPositions = persisted;
          }
        } else {
          // 无持久化数据（首次运行）→ 从磁盘加载空数组，行为与当前一致
          this.lastPositions = [];
        }
      }
      this.baselineLogged = true;

      // 离场单变化提醒；首帧只建基线，不提醒
      const exitChanges = isBaseline ? [] : this.computeExitChanges(exitOrders, events);
      this.prevExitOrders = new Map(exitOrders.map((o) => [o.oid, o]));

      // banner 类型：首帧→START；每日 force→SNAPSHOT；否则按仓位 diff 动词化（跨帧平仓凭新 oid 补 CLOSE，纯离场单/抖动为 null）
      const isOverview = isBaseline || this.tgReason === "daily";
      const kind = isBaseline ? "START" : this.tgReason === "daily" ? "SNAPSHOT"
        : (classifyBanner(events).kind ?? (newOids.size ? "CLOSE" : null));
      const clock = fmtTime();
      const displayId = this.makeDisplayId();

      // 平仓历史裁剪（方案 D）：首帧/日报显示最近 N 条概览；事件驱动仅显示本轮新平仓(⭐️)，无则不显示
      const histRecords = isOverview ? closeRecords : closeRecords.filter((r) => newOids.has(r.oid));
      const histLimit = isOverview ? this.historyLimit : histRecords.length;

      // console 单条聚合全景（不拆）：主类型缺失时按离场单动作或纯抖动留痕
      const consoleExitAction = exitChanges.length ? aggregateExitAction(exitChanges) : null;
      console.log("");
      if (kind) console.log(buildEventBanner(displayId, kind, clock));
      else if (consoleExitAction) console.log(buildExitEventBanner(displayId, consoleExitAction, clock));
      else log("无实质仓位/离场单变化（平仓历史窗口滚动），仅 console 留痕不推送");
      log(`address=${this.address}`);
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(this.positions, exitOrders, this.marginSummary));
      const histText = renderCloseHistory(histRecords, newOids, histLimit, isOverview);
      console.log("\n--- 平仓历史 Position History ---"); console.log(histText ?? "  （无平仓记录）");
      console.log("=".repeat(60) + "\n");

      // TG：全景（START/SNAPSHOT）单条并走 reportGate；事件驱动按币种/动作拆多条，全空则不发
      if (isOverview) {
        const tgText = buildTgMessage(displayId, kind, clock, this.positions, exitOrders, histRecords, newOids, histLimit, this.marginSummary, this.withdrawable);
        const hasOpenPositions = this.positions.length > 0;
        const skipReason = reportSkipReason({ kind, hasOpenPositions, isNew: this.isNew });
        if (skipReason) log(skipReason);
        else sendTelegram(this.tgToken, this.tgChat, tgText);
      } else {
        for (const text of this.buildEventMessages({ displayId, clock, events, prevPositions, newOids, histRecords, exitChanges, exitOrders })) {
          sendTelegram(this.tgToken, this.tgChat, text);
        }
      }
      // Layer 1: 推送成功后持久化 lastPositions（08-position-persistence §2.1）
      if (this.stateDir && this.lastPositions.length > 0) {
        saveLastPositions(this.stateDir, this.address, this.lastPositions);
      }
      this.tgReason = "event";
    } finally { this.fetching = false; }
  }

  // 事件驱动 TG 消息集合：非平仓变化币各一条 + 平仓合并一条 + 离场单按币各一条。
  buildEventMessages({ displayId, clock, events, prevPositions, newOids, histRecords, exitChanges, exitOrders }) {
    const key = (p) => `${p.coin}:${p.dir}`;
    const currMap = new Map(this.positions.map((p) => [key(p), p]));
    const prevMap = new Map(prevPositions.map((p) => [key(p), p]));
    const msgs = [];

    // 1) 非平仓仓位变化（OPEN / INCREASE / REDUCE）→ 各一条，仅该币卡片
    for (const e of events) {
      const [verb, dir, coin] = e.split(" ");
      const pos = currMap.get(`${coin}:${dir}`);
      if (!pos) continue;
      if (verb === "OPENED") msgs.push(buildPositionChangeMessage(displayId, "OPEN", clock, pos, null));
      else if (verb === "INCREASED") msgs.push(buildPositionChangeMessage(displayId, "INCREASE", clock, pos, prevMap.get(`${coin}:${dir}`)));
      else if (verb === "DECREASED") msgs.push(buildPositionChangeMessage(displayId, "REDUCE", clock, pos, prevMap.get(`${coin}:${dir}`)));
    }

    // 2) 平仓（CLOSED）→ 合并一条：摘要 + 剩余仓位全景 + 每平仓币 1 条历史
    let closedSummaries = events.filter((e) => e.startsWith("CLOSED")).map((e) => { const [, dir, coin] = e.split(" "); return { coin, dir }; });
    // 跨帧：仓位 diff 未抓到 CLOSED 但有新平仓记录 → 凭记录补摘要（dir 取自 fill 的 "Close Long/Short"）。
    // Layer 3 守卫（08-position-persistence §2.3）：仅当受影响的 coin 在 prevPositions 中存在时才补 CLOSE，
    // 若已不在 prevPositions 中，说明 CLOSE 已在上轮报告，延迟到达的 fill 不再重复推送。
    if (!closedSummaries.length && newOids.size) {
      const prevCoins = new Set(prevPositions.map((p) => p.coin));
      const affected = [...new Set(histRecords.filter((r) => newOids.has(r.oid)).map((r) => r.coin))];
      if (affected.some((c) => prevCoins.includes(c))) {
        closedSummaries = affected.filter((c) => prevCoins.includes(c)).map((coin) => {
          const r = histRecords.find((x) => x.coin === coin && newOids.has(x.oid));
          return { coin, dir: String(r?.dir ?? "").includes("Long") ? "LONG" : "SHORT" };
        });
      }
    }
    if (closedSummaries.length) {
      msgs.push(buildCloseMessage(displayId, clock, closedSummaries, this.positions, exitOrders, histRecords, newOids));
    }

    // 3) 离场单变化 → 按币分组，各一条（同币多动作回退 mixed）
    const byCoin = new Map();
    for (const c of exitChanges) { if (!byCoin.has(c.coin)) byCoin.set(c.coin, []); byCoin.get(c.coin).push(c); }
    for (const [coin, entries] of byCoin) {
      const action = aggregateExitAction(entries);
      const pos = this.positions.find((p) => p.coin === coin);
      msgs.push(buildExitOrderMessage(displayId, action, clock, pos, entries));
    }
    return msgs;
  }

  // 离场单 PLACE/MODIFY/CANCEL → 提醒条目。CANCEL 消歧：单消失且同窗口该 coin 仓位减/平 → 判成交，不报撤销。
  computeExitChanges(exitOrders, events) {
    const { placed, modified, canceled } = diffExitOrders(this.prevExitOrders, exitOrders);
    const reducedCoins = new Set(
      events.filter((e) => e.startsWith("DECREASED") || e.startsWith("CLOSED")).map((e) => e.split(" ")[2]),
    );
    const out = [];
    for (const o of placed) out.push(this.exitChangeEntry("place", o));
    for (const o of modified) out.push(this.exitChangeEntry("modify", o));
    for (const o of canceled) {
      if (reducedCoins.has(o.coin)) continue; // 成交→平仓事件已表达，不发撤销提醒
      out.push(this.exitChangeEntry("cancel", o));
    }
    return out;
  }

  // 单条离场变化条目：coin + 完整展示行（离场单消息前置 ⭐️）。取不到持仓则退化仅价。
  exitChangeEntry(action, order) {
    const pos = this.positions.find((p) => p.coin === order.coin);
    const view = pos ? derivePositionView(pos) : null;
    const line = view ? exitOrderLine(view, order) : `离场挂单  @ ${fmtNum(order.price, pricePrecisionOf(szDecimalsOf(order.coin)))}`;
    return { action, coin: order.coin, line };
  }

  close() { watcherRegistry.delete(this); this.closing = true; this.clearTimers(); try { this.ws?.close(); } catch {} }
}
