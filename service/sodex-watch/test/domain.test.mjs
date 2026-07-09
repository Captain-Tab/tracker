// 归一(parse) + 渲染(render) 严格单测（Node 22 内置 node:test，零依赖）
// 运行: node --test
// 注：原 format.test.mjs 同时覆盖 format/parse/render 三层；拆分后 format 部分在 tool/format.test.mjs，
//     parse/render 部分在此（被测函数现位于 process/parse.mjs 与 process/render.mjs）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePositionView, exitOrderLines, classifyBanner } from "../process/render.mjs";
import {
  canonicalReduceOnlyOrders, toPositionHistoryRecords, positionSideCN, marginModeNumLabel, diffReduceOnly,
  positionKeysFp,
} from "../process/parse.mjs";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("derivePositionView: LONG 标记价反推（#4 修复，真实示例数）", () => {
  // entry 65820, uPnl -0.26, size 0.00024 LONG, lev 25
  const v = derivePositionView({ symbol: "BTC-USD", posSide: "LONG", size: "0.00024", entry: "65820", unrealizedPnl: "-0.26", leverage: 25, liqPrice: "21885.2", marginMode: "CROSS" });
  assert.equal(v.dir, "LONG");
  assert.equal(v.dirCN, "做多");
  assert.ok(approx(v.mark, 65820 + -0.26 / 0.00024, 1e-3), `mark=${v.mark}`); // ≈ 64736.67
  assert.ok(approx(v.value, 0.00024 * v.mark, 1e-6), `value=${v.value}`);
  assert.ok(approx(v.margin, (0.00024 * 65820) / 25, 1e-9), `margin=${v.margin}`);
  assert.ok(approx(v.roe, (-0.26 / v.margin) * 100, 1e-6), `roe=${v.roe}`); // ≈ -41.1%
});

test("derivePositionView: SHORT 反推（价跌得利）", () => {
  // SHORT 0.5 @ 100，uPnl +5 → mark = 100 + 5/(-0.5) = 90
  const v = derivePositionView({ symbol: "X-USD", posSide: "SHORT", size: "0.5", entry: "100", unrealizedPnl: "5", leverage: 10, liqPrice: "150", marginMode: "ISOLATED" });
  assert.equal(v.dir, "SHORT");
  assert.equal(v.dirCN, "做空");
  assert.ok(approx(v.mark, 90), `mark=${v.mark}`);
  assert.ok(approx(v.value, 45), `value=${v.value}`);
});

test("derivePositionView: BOTH 单向模式按 size 符号判方向", () => {
  const short = derivePositionView({ symbol: "X-USD", posSide: "BOTH", size: "-0.5", entry: "100", unrealizedPnl: "0", leverage: 10, liqPrice: "", marginMode: "CROSS" });
  assert.equal(short.dir, "SHORT");
  const long = derivePositionView({ symbol: "X-USD", posSide: "BOTH", size: "0.5", entry: "100", unrealizedPnl: "0", leverage: 10, liqPrice: "", marginMode: "CROSS" });
  assert.equal(long.dir, "LONG");
});

test("derivePositionView: 无法反推 mark → null（标记价/价值显示 -）", () => {
  // entry 缺失 → mark null
  const v = derivePositionView({ symbol: "X-USD", posSide: "LONG", size: "1", entry: "", unrealizedPnl: "0", leverage: 0, liqPrice: "", marginMode: "" });
  assert.equal(v.mark, null);
  assert.equal(v.value, null);
  assert.equal(v.margin, null); // lev 0
  assert.equal(v.roe, null);
});

// ---------- 离场单（reduceOnly）指纹 ----------
test("canonicalReduceOnlyOrders: 只取 R:true，i+p+q 规范化排序", () => {
  const orders = [
    { i: 2, p: "70", q: "5", R: true },
    { i: 1, p: "85000", q: "1.2", R: true },
    { i: 3, p: "100", q: "9", R: false }, // 开仓单不计
  ];
  assert.equal(canonicalReduceOnlyOrders(orders), "1:85000:1.2,2:70:5");
});

test("canonicalReduceOnlyOrders: 空 / 非数组 → 空串", () => {
  assert.equal(canonicalReduceOnlyOrders([]), "");
  assert.equal(canonicalReduceOnlyOrders(null), "");
  assert.equal(canonicalReduceOnlyOrders([{ i: 1, p: "1", q: "1", R: false }]), "");
});

// ---------- 持仓键集合指纹（分档 debounce：结构变化 vs 滚仓）----------
test("positionKeysFp: 仅 symbol:dir，不含 size（滚仓不改指纹）", () => {
  // 同币同向，size 不同 → 键集合指纹相同（判为滚仓，走长档合并）
  const a = positionKeysFp([{ symbol: "ETH-USD", posSide: "LONG", size: "100" }]);
  const b = positionKeysFp([{ symbol: "ETH-USD", posSide: "LONG", size: "150" }]);
  assert.equal(a, b);
  assert.equal(a, "ETH-USD:LONG");
});

test("positionKeysFp: 开仓（新增键）→ 指纹变（结构变化，走短档）", () => {
  const before = positionKeysFp([{ symbol: "ETH-USD", posSide: "LONG", size: "100" }]);
  const after = positionKeysFp([
    { symbol: "ETH-USD", posSide: "LONG", size: "100" },
    { symbol: "BTC-USD", posSide: "SHORT", size: "1" },
  ]);
  assert.notEqual(before, after);
});

test("positionKeysFp: 平仓（键消失 / size=0 过滤）→ 指纹变", () => {
  const before = positionKeysFp([{ symbol: "ETH-USD", posSide: "LONG", size: "100" }]);
  const afterClose = positionKeysFp([{ symbol: "ETH-USD", posSide: "LONG", size: "0" }]);
  assert.equal(afterClose, ""); // 全平后键集合为空
  assert.notEqual(before, afterClose);
});

test("positionKeysFp: 反手（方向翻转，BOTH 按 size 符号）→ 指纹变", () => {
  const long = positionKeysFp([{ symbol: "ETH-USD", posSide: "BOTH", size: "10" }]);
  const short = positionKeysFp([{ symbol: "ETH-USD", posSide: "BOTH", size: "-10" }]);
  assert.equal(long, "ETH-USD:LONG");
  assert.equal(short, "ETH-USD:SHORT");
  assert.notEqual(long, short);
});

test("positionKeysFp: 排序稳定（数组顺序漂移不改指纹）", () => {
  const x = positionKeysFp([
    { symbol: "BTC-USD", posSide: "SHORT", size: "1" },
    { symbol: "ETH-USD", posSide: "LONG", size: "100" },
  ]);
  const y = positionKeysFp([
    { symbol: "ETH-USD", posSide: "LONG", size: "100" },
    { symbol: "BTC-USD", posSide: "SHORT", size: "1" },
  ]);
  assert.equal(x, y);
});

// ---------- 平仓历史归一化（G3 排序 + size=0 过滤）----------
test("toPositionHistoryRecords: 按 updated_at 降序（G3：pid 小但时间新排最前）", () => {
  const rows = [
    { position_id: 6999122, symbol_id: 1, position_side: 2, margin_mode: 2, size: "0", updated_at: 1781877266498, max_size: "1", cum_closed_size: "1" },
    { position_id: 6847314, symbol_id: 1, position_side: 3, margin_mode: 2, size: "0", updated_at: 1781877922860, max_size: "1", cum_closed_size: "1" }, // pid 更小但时间更新
  ];
  const recs = toPositionHistoryRecords(rows);
  assert.equal(recs[0].positionId, "6847314"); // updated_at 最新排第一
  assert.equal(recs[1].positionId, "6999122");
});

test("toPositionHistoryRecords: 仅取已平仓（size=0），未平仓过滤掉", () => {
  const rows = [
    { position_id: 1, symbol_id: 1, position_side: 2, margin_mode: 2, size: "0", updated_at: 100 },
    { position_id: 2, symbol_id: 1, position_side: 2, margin_mode: 2, size: "1.2", updated_at: 200 }, // 仍持仓
  ];
  const recs = toPositionHistoryRecords(rows);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].positionId, "1");
});

// ---------- G4 数字枚举映射 ----------
test("positionSideCN: 2→做多 / 3→做空 / 未知兜底", () => {
  assert.equal(positionSideCN(2), "做多");
  assert.equal(positionSideCN(3), "做空");
  assert.equal(positionSideCN("2"), "做多"); // 字符串数字也可
  assert.equal(positionSideCN(1), "side1"); // 未观测兜底
});

test("marginModeNumLabel: 2→Cross / 1→Isolated / 未知兜底原值", () => {
  assert.equal(marginModeNumLabel(2), "Cross");
  assert.equal(marginModeNumLabel(1), "Isolated");
  assert.equal(marginModeNumLabel(9), "9");
});

// ---------- 离场单展示（TP/SL 推断 + 全平/部分 + G11 mark null 退化）----------
test("exitOrderLines: LONG SELL 价>标记→止盈，全平", () => {
  // BTC LONG 1.2 @ 63166，mark≈63230；SELL @85000 全平 1.2 → 止盈
  const pos = { symbol: "BTC-USD", posSide: "BOTH", size: "1.2", entry: "63166", unrealizedPnl: "77", leverage: 40, liqPrice: "", marginMode: "CROSS" };
  const v = derivePositionView(pos);
  const orders = [{ orderId: "1", symbol: "BTC-USD", side: "SELL", posSide: "BOTH", price: "85000", qty: "1.2" }];
  const [line] = exitOrderLines(pos, v, orders);
  assert.match(line, /^离场挂单  止盈 @ /);
  assert.match(line, /全平/);
});

test("exitOrderLines: SHORT BUY 价<标记→止盈；部分平显示量/持仓", () => {
  // X SHORT 10 @ 100，uPnl 0 → mark 100；BUY @90 < 100 → 止盈；qty 4 < 10 → 部分
  const pos = { symbol: "X-USD", posSide: "SHORT", size: "10", entry: "100", unrealizedPnl: "0", leverage: 10, liqPrice: "", marginMode: "CROSS" };
  const v = derivePositionView(pos);
  const orders = [{ orderId: "1", symbol: "X-USD", side: "BUY", posSide: "SHORT", price: "90", qty: "4" }];
  const [line] = exitOrderLines(pos, v, orders);
  assert.match(line, /止盈/);
  assert.match(line, /部分 4 \/ 10/);
});

test("exitOrderLines: G11 mark 反推不出 → 无止盈/止损标签", () => {
  // entry 缺失 → mark null
  const pos = { symbol: "X-USD", posSide: "LONG", size: "1", entry: "", unrealizedPnl: "0", leverage: 10, liqPrice: "", marginMode: "CROSS" };
  const v = derivePositionView(pos);
  assert.equal(v.mark, null);
  const orders = [{ orderId: "1", symbol: "X-USD", side: "SELL", posSide: "LONG", price: "120", qty: "1" }];
  const [line] = exitOrderLines(pos, v, orders);
  assert.match(line, /^离场挂单  @ /); // 无标签，直接 @ 价
  assert.ok(!line.includes("止盈") && !line.includes("止损"));
});

test("exitOrderLines: 孤儿单（无对应持仓方向）不匹配", () => {
  const pos = { symbol: "BTC-USD", posSide: "LONG", size: "1", entry: "60000", unrealizedPnl: "0", leverage: 10, liqPrice: "", marginMode: "CROSS" };
  const v = derivePositionView(pos);
  // ETH 单与 BTC 仓不同币 → 不匹配
  const orders = [{ orderId: "1", symbol: "ETH-USD", side: "BUY", posSide: "BOTH", price: "1111", qty: "45" }];
  assert.equal(exitOrderLines(pos, v, orders).length, 0);
});

// ---------- 离场单 diff（G9/G10 PLACE/MODIFY/CANCEL）----------
test("diffReduceOnly: PLACE / MODIFY / CANCEL 分类", () => {
  const prev = new Map([
    ["1", { orderId: "1", price: "70", qty: "5" }],
    ["2", { orderId: "2", price: "80", qty: "3" }],
  ]);
  const curr = [
    { orderId: "1", price: "70", qty: "5" },      // 不变
    { orderId: "2", price: "85", qty: "3" },      // 改价 → MODIFY
    { orderId: "3", price: "90", qty: "1" },      // 新增 → PLACE
  ];
  const { placed, modified, canceled } = diffReduceOnly(prev, curr);
  assert.deepEqual(placed.map((o) => o.orderId), ["3"]);
  assert.deepEqual(modified.map((o) => o.orderId), ["2"]);
  assert.deepEqual(canceled, []); // 1、2 都还在
});

test("diffReduceOnly: 单消失 → CANCEL", () => {
  const prev = new Map([["1", { orderId: "1", price: "70", qty: "5" }]]);
  const { placed, modified, canceled } = diffReduceOnly(prev, []);
  assert.deepEqual(canceled.map((o) => o.orderId), ["1"]);
  assert.equal(placed.length, 0);
  assert.equal(modified.length, 0);
});

test("classifyBanner: OPEN+CLOSE 同时 → CHANGE，否则 OPEN > CLOSE > INCREASE > REDUCE", () => {
  // OPEN+CLOSE 同时存在 → CHANGE（混合事件，归平仓+反手，不偏向任一方）
  assert.equal(classifyBanner(["OPENED LONG BTC 1 @ 100", "CLOSED SHORT ETH"]).kind, "CHANGE");
  assert.equal(classifyBanner(["CLOSED LONG BTC"]).kind, "CLOSE");
  assert.equal(classifyBanner(["INCREASED LONG BTC 1→2"]).kind, "INCREASE");
  assert.equal(classifyBanner(["DECREASED LONG BTC 2→1"]).kind, "REDUCE");
});

test("classifyBanner: 无仓位 diff + 有新平仓记录 → 判 CLOSE（开平跨帧跳过）", () => {
  assert.equal(classifyBanner([], new Set(["pos-1"])).kind, "CLOSE");
});

test("classifyBanner: 无仓位 diff + 无新平仓记录 → null（离场单/抖动由消息流程分流，不再兜底 CHANGE）", () => {
  assert.equal(classifyBanner([], new Set()).kind, null);
  assert.equal(classifyBanner([]).kind, null); // 不传第二参也安全
});

test("classifyBanner: 有 CLOSED 动词时不受新平仓集合影响", () => {
  assert.equal(classifyBanner(["CLOSED LONG BTC"], new Set(["pos-1"])).kind, "CLOSE");
});
