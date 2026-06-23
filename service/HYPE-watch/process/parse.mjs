// 纯转换层：HYPE clearinghouseState / frontendOpenOrders / userFills 归一 + 指纹 + diff。
// 纯函数，零依赖（叶子模块）。归一模型见 spec 总纲 §3.1。
// 数字全为字符串，统一 Number()；空串/null → null（render 显示 "-"）。

const num = (v) => (v === "" || v == null ? NaN : Number(v));

// HYPE perps 价格精度：MAX_DECIMALS(6) - szDecimals
export const pricePrecisionOf = (szDecimals) => Math.max(0, 6 - Number(szDecimals));

export const positionDirection = (size) => (Number(size) < 0 ? "SHORT" : "LONG");

// ---------- 当前仓位归一（来源 clearinghouseState.assetPositions[].position）----------
export function parsePositions(assetPositions, szDecimalsOf) {
  if (!Array.isArray(assetPositions)) return [];
  return assetPositions
    .map((ap) => ap?.position)
    .filter((p) => p && Number(p.szi) !== 0)
    .map((p) => {
      const size = Number(p.szi); // szi 已带符号（正多负空）
      const absSize = Math.abs(size);
      const positionValue = num(p.positionValue);
      // mark 由 positionValue / |size| 反推（HYPE 不在持仓里直接给 markPx）
      const mark = Number.isFinite(positionValue) && absSize !== 0 ? positionValue / absSize : null;
      const szDecimals = szDecimalsOf(p.coin);
      return {
        coin: String(p.coin),
        size,
        dir: positionDirection(size),
        entry: num(p.entryPx),
        mark,
        unrealizedPnl: num(p.unrealizedPnl),
        roe: num(p.returnOnEquity), // 已是比例（0.438 = 43.8%）
        leverage: { mode: String(p.leverage?.type ?? ""), value: Number(p.leverage?.value ?? 0) },
        liqPrice: p.liquidationPx == null ? null : num(p.liquidationPx),
        marginUsed: num(p.marginUsed),
        positionValue: Number.isFinite(positionValue) ? positionValue : null,
        szDecimals,
        pricePrecision: pricePrecisionOf(szDecimals),
      };
    });
}

// ---------- 离场挂单归一（来源 frontendOpenOrders，取 reduceOnly / isPositionTpsl）----------
export function parseExitOrders(frontendOrders) {
  if (!Array.isArray(frontendOrders)) return [];
  return frontendOrders
    .filter((o) => o && (o.reduceOnly === true || o.isPositionTpsl === true))
    .map((o) => ({
      coin: String(o.coin),
      side: String(o.side ?? ""), // B 买 / A 卖
      price: num(o.limitPx),
      size: num(o.sz),
      reduceOnly: true,
      kind: exitKind(o),
      triggerPx: o.triggerPx == null ? null : num(o.triggerPx),
      oid: Number(o.oid),
    }));
}

// TP/SL 判定：orderType 文案优先（"Take Profit *" → TP，"Stop *" → SL）
function exitKind(o) {
  const t = String(o.orderType ?? "").toLowerCase();
  if (t.includes("take profit") || t.includes("tp")) return "TP";
  if (t.includes("stop") || t.includes("sl")) return "SL";
  return "";
}

// ---------- 平仓记录归一（来源 userFills，dir 含 "Close"，按 oid 分组聚合）----------
export function parseCloseRecords(fills) {
  if (!Array.isArray(fills)) return [];
  const byOid = new Map();
  for (const f of fills) {
    if (!f || !String(f.dir).includes("Close")) continue;
    const oid = Number(f.oid);
    const prev = byOid.get(oid);
    if (!prev) {
      byOid.set(oid, {
        coin: String(f.coin),
        dir: String(f.dir),
        closedPnl: num(f.closedPnl) || 0,
        fee: num(f.fee) || 0,
        size: num(f.sz) || 0,
        price: num(f.px),
        time: Number(f.time),
        oid,
      });
    } else {
      // 同 oid 多笔成交聚合：pnl/fee/size 求和；price/time 取最新一笔
      prev.closedPnl += num(f.closedPnl) || 0;
      prev.fee += num(f.fee) || 0;
      prev.size += num(f.sz) || 0;
      if (Number(f.time) > prev.time) { prev.time = Number(f.time); prev.price = num(f.px); }
    }
  }
  return [...byOid.values()].sort((a, b) => b.time - a.time);
}

// ---------- 指纹 ----------
// 仓位指纹：coin:dir:absSize 排序（不含 pnl/mark，mark 跳动被 dedup）
export function canonicalPositionsFp(positions) {
  return positions
    .map((p) => `${p.coin}:${p.dir}:${Math.abs(p.size)}`)
    .sort()
    .join(",");
}

// 开放挂单指纹（来源 WS openOrders，仅作变化触发；oid:limitPx:sz 排序）
export function canonicalOpenOrdersFp(wsOrders) {
  if (!Array.isArray(wsOrders)) return "";
  return wsOrders
    .map((o) => `${o.oid}:${o.limitPx}:${o.sz}`)
    .sort()
    .join(",");
}

// 离场单集合 diff（按 oid）：PLACE / MODIFY / CANCEL。
// MODIFY 只认 price 变化——size 变小多为部分成交（frontendOpenOrders.sz 是剩余量），不误报为改单。
// 交易所撤旧+新单实现改单时退化为 CANCEL+PLACE（可接受）。
export function diffExitOrders(prevMap, currList) {
  const placed = [];
  const modified = [];
  const canceled = [];
  const currIds = new Set();
  for (const o of currList) {
    currIds.add(o.oid);
    const prev = prevMap.get(o.oid);
    if (!prev) placed.push(o);
    else if (prev.price !== o.price) modified.push(o);
  }
  for (const [id, o] of prevMap) if (!currIds.has(id)) canceled.push(o);
  return { placed, modified, canceled };
}

// ---------- diff（banner 动词化）----------
export function diffPositions(prev, curr) {
  const key = (p) => `${p.coin}:${p.dir}`;
  const pm = new Map(prev.map((p) => [key(p), p]));
  const cm = new Map(curr.map((p) => [key(p), p]));
  const events = [];
  for (const [k, p] of cm) {
    const amt = Math.abs(p.size);
    const b = pm.get(k);
    if (!b) events.push(`OPENED ${p.dir} ${p.coin} ${amt} @ ${p.entry}`);
    else if (p.size !== b.size) {
      const grew = Math.abs(p.size) > Math.abs(b.size);
      events.push(`${grew ? "INCREASED" : "DECREASED"} ${p.dir} ${p.coin} ${Math.abs(b.size)}→${amt}`);
    }
  }
  for (const [k, p] of pm) if (!cm.has(k)) events.push(`CLOSED ${p.dir} ${p.coin}`);
  return events;
}
