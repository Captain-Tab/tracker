// 有状态编排层：WS 连接生命周期 + 事件监听 + 去抖触发 + 拉取聚合 + 推送。
// WS polyfill 在此（非 api，避免 query 被迫依赖 ws）；共享限流状态经 live binding 读 api。
import { fmtTime, fmtNum, pickAt, formatDisplayId } from "../../tool/format.mjs";
import { reportSkipReason } from "../../tool/reportGate.mjs";
import {
  parseWsPosition, parseReduceOnlyOrders, canonicalReduceOnlyOrders, canonicalPositionsFp,
  positionKeysFp, diffPositions, diffReduceOnly, baseCoin, positionDirection, parseRestPositions,
} from "./parse.mjs";
import {
  classifyBanner, buildEventBanner, buildExitEventBanner, renderPositions, renderPositionHistory,
  buildTgMessage, buildPositionChangeMessage, buildCloseMessage, buildExitOrderMessage,
  derivePositionView, exitOrderLine,
} from "./render.mjs";
import {
  log, parseJsonSafe, fetchPositionHistory, sendTelegram, resolveAccountIdViaChain,
  enterSharedRateLimit, nextSharedBackoffMs, resetSharedBackoff, watcherRegistry,
  sharedRateLimitUntil, THROTTLE_STATUSES, SEEN_IDS_CAP, symbolMeta, symbolMetaBySymbol,
} from "../api/index.mjs";
import { installWsProxy } from "../../lib/WARP/index.mjs";
import { writeSignal } from "../../lib/copy-signal/index.mjs";
import { loadLastPositions, saveLastPositions, loadAccountId, saveAccountId } from "../../tool/lastPositionsStore.mjs";
import { msUntilNextShanghai } from "./snapshot.mjs";

const CHANNELS = ["accountState", "accountUpdate", "accountOrderUpdate", "accountTrade"];

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// WS 代理 polyfill：统一封装在 lib/WARP；缺 ws 包 → exit(1)（保留现有行为）
try {
  await installWsProxy();
} catch {
  console.error("需要安装 ws 包:\n  npm install ws");
  process.exit(1);
}

// 平仓历史 position_side 数字 → 方向英文（跨帧平仓摘要用；2=LONG / 3=SHORT）
const RECORD_SIDE_DIR = { 2: "LONG", 3: "SHORT" };

// 一组离场单变化的聚合动作：全同一动作则用之，混合回退 mixed。
function aggregateExitAction(entries) {
  const actions = new Set(entries.map((e) => e.action));
  return actions.size === 1 ? [...actions][0] : "mixed";
}

// ---------- 监听器 ----------
export class AccountWatcher {
  constructor(env, address, flags) {
    this.env = env;
    this.address = address;
    this.flags = flags;
    this.historyLimit = Number(flags["history-limit"] ?? 2);
    // 短档：开/平/反手/离场单等结构变化即时推（沿用原值）
    this.debounceMs = Number(flags["debounce-ms"] ?? 3000);
    this.maxWaitMs = Number(flags["max-wait-ms"] ?? 5000);
    // 长档：同仓滚仓加减仓（仅 size 变）合并，治理刷屏。设为与短档相同即回退原行为。
    this.tierDebounceMs = Number(flags["tier-debounce-ms"] ?? 20000);
    this.tierMaxWaitMs = Number(flags["tier-max-wait-ms"] ?? 90000);
    this.accountId = flags["account-id"] ?? null;
    this.tgToken = flags["tg-token"] ?? null;
    this.tgChat = flags["tg-chat"] ?? null;
    this.label = flags.label ?? null;
    this.at = pickAt(flags.at, undefined); // 非法 --at 回退默认 20:00
    this.isNew = flags.isNew !== false; // START 门控：缺省 true（单地址 CLI 不门控）
    this.forceReport = false;
    this.dailyTimer = null;
    this.tgReason = "event";
    this.retryScheduled = false;
    this.ws = null;
    this.requestId = 0;
    this.reconnectAttempt = 0;
    this.pingTimer = null;
    this.pongTimer = null;
    this.debounceTimer = null;
    this.firstPendingAt = 0;
    this.closing = false;
    this.fetching = false;
    this.positions = [];
    this.ordersRaw = [];
    this.lastPositions = [];
    this.seenPositionIds = new Set();
    this.prevReduceOnly = new Map(); // orderId → 归一化单（G10 离场单 diff）
    this.baselineLogged = false;
    this.stateFp = null;
    this.lastOutFp = null;
    // 跟单事件信号（可选，加法）：copy-signal-path 未配则全程 no-op，watch 行为 diff=0
    this.copySignalPath = flags["copy-signal-path"] ?? null;
    this.copySignalSeq = 0;
    // 仓位状态持久化（08-position-persistence §2.1）
    this.stateDir = flags["state-dir"] ?? null;
    // 从磁盘恢复 accountId（供 Layer 2 REST 兜底）
    this.accountId = flags["account-id"] ?? (this.stateDir ? loadAccountId(this.stateDir, address) : null);
    // 分档 debounce：与上次推送的"持仓键集合 / 离场单集合"比对判结构变化；
    // pendingStructural = 当前 debounce 窗口内是否出现结构变化（只升不降，取最紧急）。
    // 初值 null 表示"从未推送过"，使首帧 baseline（含空仓账户）必判结构变化 → 短档即时推 START WATCH。
    this.lastKeysFp = null;
    this.lastReduceFp = null;
    this.pendingStructural = false;
  }

  makeDisplayId() {
    return formatDisplayId(this.address, this.label);
  }

  start() { watcherRegistry.add(this); this.connect(); }

  connect() {
    const url = `${this.env.gatewayWs}/ws/perps`;
    log(`连接 ${url}（无鉴权）`);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      log("OPEN，订阅账户频道");
      for (const channel of CHANNELS) this.send({ op: "subscribe", id: ++this.requestId, params: { channel, user: this.address } });
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
    this.pingTimer = setInterval(() => { this.send({ op: "ping" }); this.pongTimer = setTimeout(() => { log("pong 超时，断开重连"); try { this.ws?.close(); } catch {} }, PONG_TIMEOUT_MS); }, PING_INTERVAL_MS);
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
    log(`下次每日快照：${this.at} 上海时间（约 ${Math.round(ms / 60000)} 分钟后）`);
  }

  handleMessage(raw) {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    let msg;
    try { msg = parseJsonSafe(typeof raw === "string" ? raw : String(raw)); } catch { return; }
    if (msg.op === "pong") return;
    if (msg.op === "subscribe" || msg.op === "unsubscribe") { if (msg.success === false) log(`订阅失败：${msg.error ?? "unknown"}`); return; }
    if (!msg.channel) return;
    if (this.flags.raw) log(`RECV [${msg.channel}] type=${msg.type ?? "update"}`);

    if (msg.channel === "accountState") {
      const data = msg.data ?? {};
      if (!this.accountId) { const aid = data.aid ?? data.accountId ?? data.account_id ?? null; if (aid) { this.accountId = String(aid); log(`accountId = ${this.accountId}（来自 WS 快照）`); if (this.stateDir) saveAccountId(this.stateDir, this.address, this.accountId); } }
      this.positions = Array.isArray(data.P) ? data.P.map(parseWsPosition) : [];
      this.ordersRaw = Array.isArray(data.O) ? data.O : [];
      // 触发指纹 = 仓位身份 + 离场单集合（reduceOnly 挂/改/撤即时触发；开仓单不计，避免 churn）
      const reduceFp = canonicalReduceOnlyOrders(this.ordersRaw);
      const fp = canonicalPositionsFp(this.positions) + "|" + reduceFp;
      // 结构变化（开仓/平仓/反手 → 键集合变；离场单挂改撤 → reduceOnly 变）相对上次推送 → 短档即时；
      // 仅 abs(size) 变（同仓滚仓加减仓）→ 长档合并。
      const structural = positionKeysFp(this.positions) !== this.lastKeysFp || reduceFp !== this.lastReduceFp;
      if (fp !== this.stateFp) {
        this.stateFp = fp;
        this.emitCopySignal(); // 跟单脏标：变化确认即发（TG 推送之前），加法、未配则 no-op
        this.scheduleFetch(structural);
      }
      return;
    }
    // 成交 / 订单推送只作"重新评估"提示，状态以 accountState 全量快照为准；
    // 无持仓上下文，不改变档位（structural=false，pendingStructural 只升不降）。
    if (msg.channel === "accountTrade" || msg.channel === "accountOrderUpdate") this.scheduleFetch(false);
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
    if (structural) this.pendingStructural = true; // 只升级，取窗口内最紧急档
    const now = Date.now();
    if (this.firstPendingAt === 0) this.firstPendingAt = now;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // 分档：结构变化（开/平/反手/离场单）走短档即时；滚仓走长档合并。
    const debounceMs = this.pendingStructural ? this.debounceMs : this.tierDebounceMs;
    const maxWaitMs = this.pendingStructural ? this.maxWaitMs : this.tierMaxWaitMs;
    // maxWait 封顶：自首个待处理事件起超过 maxWaitMs 立即 flush，
    // 避免活跃成交流（事件间隔<debounceMs）让 trailing 防抖一直被推后而饥饿。
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
    // 冷却兜底：限流前已 armed 的 debounceTimer 可能在冷却期内 fire，
    // 此处再 gate 一次，避免在 sharedRateLimitUntil 内打出请求又触发限流。
    if (Date.now() < sharedRateLimitUntil) return;
    this.fetching = true;
    try {
      if (!this.accountId) { this.accountId = await resolveAccountIdViaChain(this.env, this.address); if (!this.accountId) { log("无法解析 accountId，跳过"); return; } log(`accountId = ${this.accountId}（来自 chain api）`); }
      let result = null;
      try {
        result = await fetchPositionHistory(this.env, this.accountId);
        resetSharedBackoff();
      } catch (err) {
        log(`[平仓历史拉取失败] ${err.message}`);
        if (THROTTLE_STATUSES.has(err.status)) {
          // 限流：优先服务端 Retry-After，否则指数退避 + jitter；模块级 gate 全员；
          // 冷却结束由 scheduleSharedWake 唤醒全部 watcher（G2），不在此处单实例 setTimeout。
          const waitMs = err.retryAfterMs ?? nextSharedBackoffMs();
          enterSharedRateLimit(waitMs);
          log(`触发限流(${err.status})，${Math.round(waitMs / 1000)}s 后全员恢复`);
        }
      }
      // 拉取失败（限流/硬错误）：不渲染空数据，保留 lastOutFp / forceReport 待下次成功（不误报）
      if (result === null) return;

      const records = result.records ?? [];
      const reduceOnly = parseReduceOnlyOrders(this.ordersRaw);
      // G1：出参去重须含 reduceOnly + 平仓 position_id 集，否则纯挂单变化(仓位/平仓均无变)被去重 → 即时提醒失效
      const closedIdsFp = records.map((r) => r.positionId).sort().join(",");
      const outFp = canonicalPositionsFp(this.positions) + "|" + canonicalReduceOnlyOrders(this.ordersRaw) + "|" + closedIdsFp;
      const force = this.forceReport; this.forceReport = false;
      if (!force && outFp === this.lastOutFp) return;

      const events = diffPositions(this.lastPositions, this.positions);

      // ★ 复用：首帧基线全部不标，之后新出现的已平仓位（新 position_id）标 ★
      const newPosIds = new Set();
      for (const r of records) { if (!this.seenPositionIds.has(r.positionId)) { this.seenPositionIds.add(r.positionId); if (this.baselineLogged) newPosIds.add(r.positionId); } }
      if (this.seenPositionIds.size > SEEN_IDS_CAP) this.seenPositionIds = new Set(records.map((r) => r.positionId));
      const isBaseline = !this.baselineLogged;
      this.baselineLogged = true;

      // Layer 2: 首帧从磁盘恢复 lastPositions + REST 兜底（08-position-persistence §2.2）
      if (isBaseline && this.stateDir) {
        const persisted = loadLastPositions(this.stateDir, this.address);
        // 尝试 REST 交叉验证（需要 accountId）
        if (this.accountId) {
          try {
            const result = await fetchPositionHistory(this.env, this.accountId);
            const restRows = result?.raw?.data;
            if (Array.isArray(restRows)) {
              const restPositions = parseRestPositions(restRows, symbolMeta);
              if (restPositions.length > 0 || persisted.length > 0) {
                // 转换 REST 格式 → diffPositions 兼容格式
                const restCurr = restPositions.map((p) => ({
                  coin: baseCoin(p.symbol),
                  dir: positionDirection(p),
                  size: Number(p.size),
                  entry: p.entry,
                }));
                log(`[REST 兜底] 持久化 ${persisted.length} 个仓位，REST 返回 ${restCurr.length} 个仓位`);
                this.positions = restCurr;
                this.lastPositions = persisted; // 保留持久化基线用于 diff
              }
            }
          } catch (e) {
            log(`[REST 兜底] fetchPositionHistory 失败(${e.message})，降级`);
            if (persisted.length > 0) this.lastPositions = persisted;
          }
        } else if (persisted.length > 0) {
          log(`[持久化恢复] 从磁盘加载 ${persisted.length} 个仓位基线（无 accountId，跳过 REST）`);
          this.lastPositions = persisted;
        }
      }

      // G5/G6：检测到 CLOSED 仓位事件但平仓历史尚无对应新 position_id → positions 索引延迟，2s 补拉
      const hasClosed = events.some((e) => e.startsWith("CLOSED"));
      if (!force && !isBaseline && hasClosed && newPosIds.size === 0) {
        if (!this.retryScheduled) { this.retryScheduled = true; this.lastOutFp = null; setTimeout(() => { this.retryScheduled = false; this.scheduleFetch(true); }, 2000); }
        return;
      }
      this.retryScheduled = false;

      // 确认上报后才推进 diff/档位基准：G5/G6 补拉 return 前不推进，保证 2s 重拉仍以“变化前”为对照，
      // 避免全平的 CLOSED（及同帧加减仓）动词被吞、banner 降级为 POSITION CHANGE。
      this.lastOutFp = outFp;
      // 保证金/量级变化需“变化前”仓位：推进 lastPositions 前快照 prev（events 已基于其算出）
      const prevPositions = this.lastPositions;
      this.lastPositions = this.positions;
      this.lastKeysFp = positionKeysFp(this.positions);
      this.lastReduceFp = canonicalReduceOnlyOrders(this.ordersRaw);
      this.pendingStructural = false;

      // 离场单变化提醒；首帧只建立基线，不提醒
      const exitChanges = isBaseline ? [] : this.computeExitChanges(reduceOnly, events);
      this.prevReduceOnly = new Map(reduceOnly.map((o) => [o.orderId, o]));

      // banner 类型：首帧→START WATCH；每日 force→SNAPSHOT；否则按仓位 diff 动词化（可能为 null，如纯离场单/抖动帧）
      const isOverview = isBaseline || this.tgReason === "daily";
      const kind = isBaseline ? "START" : this.tgReason === "daily" ? "SNAPSHOT" : classifyBanner(events, newPosIds).kind;
      const clock = fmtTime();
      const displayId = this.makeDisplayId();

      // 平仓历史裁剪（方案 D）：首帧/日报显示最近 N 条概览；事件驱动仅显示本轮新平仓(⭐️)，无则不显示
      const histRecords = isOverview ? records : records.filter((r) => newPosIds.has(r.positionId));
      const histLimit = isOverview ? this.historyLimit : histRecords.length;

      // console 单条聚合全景（不拆）：主类型缺失时按离场单动作或纯抖动留痕
      const consoleExitAction = exitChanges.length ? aggregateExitAction(exitChanges) : null;
      console.log("");
      if (kind) console.log(buildEventBanner(displayId, kind, clock));
      else if (consoleExitAction) console.log(buildExitEventBanner(displayId, consoleExitAction, clock));
      else log("无实质仓位/离场单变化（平仓历史窗口滚动），仅 console 留痕不推送");
      log(`account_id=${this.accountId}`);
      console.log("\n--- 当前仓位 Positions ---"); console.log(renderPositions(this.positions, reduceOnly));
      const histText = renderPositionHistory(histRecords, newPosIds, histLimit, isOverview);
      console.log("\n--- 平仓历史 Position History ---"); console.log(histText ?? "  （无平仓记录）");
      if (this.flags.raw && result?.raw) { console.log("\n--- raw positions ---"); console.log(JSON.stringify(result.raw, null, 2)); }
      console.log("=".repeat(60) + "\n");

      // TG：全景（START/SNAPSHOT）单条并走 reportGate；事件驱动按币种/动作拆多条，全空则不发
      if (isOverview) {
        const tgText = buildTgMessage(displayId, kind, clock, this.positions, reduceOnly, histRecords, newPosIds, histLimit);
        const hasOpenPositions = this.positions.some((p) => Number(p.size) !== 0);
        const skipReason = reportSkipReason({ kind, hasOpenPositions, isNew: this.isNew });
        if (skipReason) log(skipReason);
        else sendTelegram(this.tgToken, this.tgChat, tgText);
      } else {
        for (const text of this.buildEventMessages({ displayId, clock, events, prevPositions, newPosIds, histRecords, exitChanges, reduceOnly })) {
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
  buildEventMessages({ displayId, clock, events, prevPositions, newPosIds, histRecords, exitChanges, reduceOnly }) {
    const key = (p) => `${baseCoin(p.symbol)}:${positionDirection(p)}`;
    const currMap = new Map(this.positions.filter((p) => Number(p.size) !== 0).map((p) => [key(p), p]));
    const prevMap = new Map(prevPositions.filter((p) => Number(p.size) !== 0).map((p) => [key(p), p]));
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
    // 跨帧：仓位 diff 未抓到 CLOSED 但有新平仓记录 → 凭记录补摘要。
    // Layer 3 守卫（08-position-persistence §2.3）：仅当受影响的 coin 在 prevPositions 中存在时才补 CLOSE。
    if (!closedSummaries.length && newPosIds.size) {
      const prevCoins = new Set(prevPositions.map((p) => p.coin));
      const affected = [...new Set(histRecords.filter((r) => newPosIds.has(r.positionId)).map((r) => symbolMeta(r.symbolId).baseCoin).filter(Boolean))];
      if (affected.some((c) => prevCoins.has(c))) {
        closedSummaries = affected.filter((c) => prevCoins.has(c)).map((coin) => {
          const r = histRecords.find((x) => symbolMeta(x.symbolId).baseCoin === coin && newPosIds.has(x.positionId));
          return { coin, dir: RECORD_SIDE_DIR[Number(r?.positionSide ?? 0)] ?? "" };
        });
      }
    }
    if (closedSummaries.length) {
      msgs.push(buildCloseMessage(displayId, clock, closedSummaries, this.positions, reduceOnly, histRecords, newPosIds));
    }

    // 3) 离场单变化 → 按币分组，各一条（同币多动作回退 mixed）
    const byCoin = new Map();
    for (const c of exitChanges) { if (!byCoin.has(c.coin)) byCoin.set(c.coin, []); byCoin.get(c.coin).push(c); }
    for (const [coin, entries] of byCoin) {
      const action = aggregateExitAction(entries);
      const pos = this.positions.find((p) => baseCoin(p.symbol) === coin && Number(p.size) !== 0);
      msgs.push(buildExitOrderMessage(displayId, action, clock, pos, entries));
    }
    return msgs;
  }

  // 离场单 PLACE/MODIFY/CANCEL → 提醒条目。FILL 不双报：单消失且同窗口该 coin 仓位减/平 → 判成交，归平仓事件不报撤销。
  computeExitChanges(reduceOnly, events) {
    const { placed, modified, canceled } = diffReduceOnly(this.prevReduceOnly, reduceOnly);
    const reducedCoins = new Set(
      events.filter((e) => e.startsWith("DECREASED") || e.startsWith("CLOSED")).map((e) => e.split(" ")[2]),
    );
    const out = [];
    for (const o of placed) out.push(this.exitChangeEntry("place", o));
    for (const o of modified) out.push(this.exitChangeEntry("modify", o));
    for (const o of canceled) {
      if (reducedCoins.has(baseCoin(o.symbol))) continue; // 成交→平仓事件已表达，不发撤销提醒
      out.push(this.exitChangeEntry("cancel", o));
    }
    return out;
  }

  // 单条离场变化条目：coin + 完整展示行（离场单消息前置 ⭐️）。取不到持仓则退化仅价。
  exitChangeEntry(action, order) {
    const pos = this.positions.find((p) => baseCoin(p.symbol) === baseCoin(order.symbol) && Number(p.size) !== 0);
    const view = pos ? derivePositionView(pos) : null;
    const meta = symbolMetaBySymbol(order.symbol);
    const line = view ? exitOrderLine(view, order) : `离场挂单  @ ${fmtNum(order.price, meta.pricePrecision)}`;
    return { action, coin: meta.baseCoin || baseCoin(order.symbol), line };
  }

  close() { watcherRegistry.delete(this); this.closing = true; this.clearTimers(); try { this.ws?.close(); } catch {} }
}
