// 纯转换层：WS 快照仓位 / 离场单归一化 + 指纹 + 平仓历史归一 + 仓位/离场单 diff。
// 纯函数，零依赖（叶子模块）。

export const baseCoin = (symbol) => String(symbol).split(/[-/]/)[0];

// ---------- WS 快照仓位 / 离场单解析 ----------
export function parseWsPosition(p) {
  return {
    symbol: String(p.s ?? p.symbol ?? "?"),
    posSide: String(p.ps ?? p.positionSide ?? ""),
    size: String(p.sz ?? p.size ?? "0"),
    entry: String(p.ep ?? p.avgEntryPrice ?? ""),
    unrealizedPnl: String(p.ur ?? p.unrealizedPnl ?? "0"),
    realizedPnl: String(p.cr ?? p.realizedPnL ?? "0"),
    leverage: Number(p.l ?? p.leverage ?? 0),
    liqPrice: String(p.lp ?? p.liquidationPrice ?? ""),
    marginMode: String(p.m ?? p.marginMode ?? ""),
  };
}

// 离场单（reduceOnly，R:true）归一化。WS data.O 字段：i 单号 / s 币 / S BUY|SELL /
// p 价 / q 量 / z 已成交 / ps LONG|SHORT|BOTH / o 类型 / X 状态。开仓单(R:false)不取。
export function parseReduceOnlyOrders(orders) {
  if (!Array.isArray(orders)) return [];
  return orders.filter((o) => o && o.R === true).map((o) => ({
    orderId: String(o.i),
    symbol: String(o.s ?? "?"),
    side: String(o.S ?? ""),
    posSide: String(o.ps ?? ""),
    price: String(o.p ?? ""),
    qty: String(o.q ?? ""),
    filled: String(o.z ?? "0"),
    type: String(o.o ?? ""),
    status: String(o.X ?? ""),
  }));
}

// 离场单规范化指纹：只取 R:true，i+p+q 排序拼接（不含开仓单，避免 churn）。
export function canonicalReduceOnlyOrders(orders) {
  if (!Array.isArray(orders)) return "";
  return orders
    .filter((o) => o && o.R === true)
    .map((o) => `${o.i}:${o.p}:${o.q}`)
    .sort()
    .join(",");
}

export function positionDirection(p) {
  if (p.posSide === "LONG" || p.posSide === "SHORT") return p.posSide;
  return Number(p.size) < 0 ? "SHORT" : "LONG";
}

// 仓位指纹：规范化后再比对（abs(size) + 派生方向 + 按 symbol 排序），
// 消除"表示/数组顺序漂移被误判为变化"导致的重复触发/重复上报。
export function canonicalPositionsFp(positions) {
  return positions
    .filter((p) => Number(p.size) !== 0)
    .map((p) => `${p.symbol}:${positionDirection(p)}:${Math.abs(Number(p.size))}`)
    .sort()
    .join(",");
}

export function marginModeLabel(m) {
  if (/cross/i.test(m)) return "Cross";
  if (/iso/i.test(m)) return "Isolated";
  return m || "-";
}

// ---------- 平仓历史归一化 ----------
// G4 数字枚举映射（与 WS 字符串 ps/m 不同源，平仓历史走自己的数字映射）：
const POSITION_SIDE_CN = { 2: "做多", 3: "做空" }; // 2=LONG / 3=SHORT；1 未观测，兜底原值
const MARGIN_MODE_NUM = { 1: "Isolated", 2: "Cross" }; // 实测全为 2=Cross

export function positionSideCN(side) {
  return POSITION_SIDE_CN[Number(side)] ?? `side${side}`;
}

export function marginModeNumLabel(m) {
  return MARGIN_MODE_NUM[Number(m)] ?? String(m);
}

// G3：接口按 position_id 返回（非平仓时间），pid 小但 updated_at 新会排后
// → 客户端按 updated_at 降序排序后再取最近 N。仅取已平仓（size=0）。
export function toPositionHistoryRecords(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => Number(r.size) === 0)
    .map((r) => ({
      positionId: String(r.position_id),
      symbolId: Number(r.symbol_id),
      positionSide: Number(r.position_side),
      marginMode: Number(r.margin_mode),
      maxSize: r.max_size,
      cumClosedSize: r.cum_closed_size,
      avgEntryPrice: r.avg_entry_price,
      avgClosePrice: r.avg_close_price,
      realizedPnl: r.realized_pnl,
      fundingFee: r.funding_fee,
      updatedAt: Number(r.updated_at),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------- diff ----------
export function diffPositions(prev, curr) {
  const open = (arr) => arr.filter((p) => Number(p.size) !== 0);
  const key = (p) => `${baseCoin(p.symbol)}:${positionDirection(p)}`;
  const pm = new Map(open(prev).map((p) => [key(p), p]));
  const cm = new Map(open(curr).map((p) => [key(p), p]));
  const events = [];
  for (const [k, p] of cm) {
    const dir = positionDirection(p);
    const amt = Math.abs(Number(p.size));
    const b = pm.get(k);
    if (!b) events.push(`OPENED ${dir} ${baseCoin(p.symbol)} ${amt} @ ${p.entry}`);
    else if (b.size !== p.size) {
      const grew = Math.abs(Number(p.size)) > Math.abs(Number(b.size));
      events.push(`${grew ? "INCREASED" : "DECREASED"} ${dir} ${baseCoin(p.symbol)} ${Math.abs(Number(b.size))}→${amt}`);
    }
  }
  for (const [k, p] of pm) if (!cm.has(k)) events.push(`CLOSED ${positionDirection(p)} ${baseCoin(p.symbol)}`);
  return events;
}

// 离场单集合 diff（G9/G10）：按 orderId 比对得出 PLACE / MODIFY / CANCEL。
// G9 MODIFY：同 orderId 的 p/q 变 → 一条"调整"；交易所撤旧+新单实现改单时退化为 CANCEL+PLACE（可接受）。
export function diffReduceOnly(prevMap, currList) {
  const placed = [];
  const modified = [];
  const canceled = [];
  const currIds = new Set();
  for (const o of currList) {
    currIds.add(o.orderId);
    const prev = prevMap.get(o.orderId);
    if (!prev) placed.push(o);
    else if (prev.price !== o.price || prev.qty !== o.qty) modified.push(o);
  }
  for (const [id, o] of prevMap) if (!currIds.has(id)) canceled.push(o);
  return { placed, modified, canceled };
}
