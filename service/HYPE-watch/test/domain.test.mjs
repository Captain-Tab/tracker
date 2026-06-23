// HYPE-watch parse 纯函数单测：归一 / 方向 / mark 反推 / group-by-oid / 指纹 / diff。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePositions, parseExitOrders, parseCloseRecords,
  canonicalPositionsFp, canonicalOpenOrdersFp, diffPositions, diffExitOrders, pricePrecisionOf, positionDirection,
} from "../process/parse.mjs";

const szOf = (coin) => ({ HYPE: 2, BTC: 5 }[coin] ?? 4);

test("parsePositions: szi 正→多、mark=positionValue/|size|、精度=6-szDecimals", () => {
  const ap = [{ position: { coin: "HYPE", szi: "200.0", leverage: { type: "cross", value: 3 }, entryPx: "60.4627", positionValue: "13862.0", unrealizedPnl: "1769.44", returnOnEquity: "0.4389", liquidationPx: null, marginUsed: "4620.66" } }];
  const [p] = parsePositions(ap, szOf);
  assert.equal(p.coin, "HYPE");
  assert.equal(p.size, 200);
  assert.equal(p.dir, "LONG");
  assert.equal(p.mark, 13862.0 / 200);
  assert.equal(p.liqPrice, null);
  assert.equal(p.leverage.mode, "cross");
  assert.equal(p.szDecimals, 2);
  assert.equal(p.pricePrecision, 4); // 6-2
});

test("parsePositions: szi 负→空，size=0 过滤", () => {
  const ap = [
    { position: { coin: "ETH", szi: "-5.0", leverage: { type: "isolated", value: 10 }, entryPx: "1779", positionValue: "8895", unrealizedPnl: "0", returnOnEquity: "0" } },
    { position: { coin: "SOL", szi: "0", entryPx: "0", positionValue: "0", unrealizedPnl: "0" } },
  ];
  const ps = parsePositions(ap, szOf);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].dir, "SHORT");
});

test("positionDirection / pricePrecisionOf", () => {
  assert.equal(positionDirection("-3"), "SHORT");
  assert.equal(positionDirection("3"), "LONG");
  assert.equal(pricePrecisionOf(5), 1);
  assert.equal(pricePrecisionOf(2), 4);
});

test("parseCloseRecords: 同 oid 多笔 fill 聚合成一行，pnl/fee/size 求和", () => {
  const fills = [
    { coin: "HYPE", dir: "Close Long", closedPnl: "3.2", fee: "0.1", sz: "10", px: "60", time: 100, oid: 1 },
    { coin: "HYPE", dir: "Close Long", closedPnl: "1.9", fee: "0.05", sz: "5", px: "61", time: 200, oid: 1 },
    { coin: "HYPE", dir: "Close Long", closedPnl: "5.1", fee: "0.2", sz: "8", px: "62", time: 300, oid: 1 },
    { coin: "ETH", dir: "Open Long", closedPnl: "0", fee: "0.1", sz: "1", px: "1700", time: 250, oid: 2 }, // 非 Close 忽略
  ];
  const recs = parseCloseRecords(fills);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.oid, 1);
  assert.ok(Math.abs(r.closedPnl - 10.2) < 1e-9);
  assert.ok(Math.abs(r.fee - 0.35) < 1e-9);
  assert.equal(r.size, 23);
  assert.equal(r.price, 62); // 取最新一笔（time 最大）
  assert.equal(r.time, 300);
});

test("parseExitOrders: 取 reduceOnly / isPositionTpsl，TP/SL 判定", () => {
  const orders = [
    { coin: "HYPE", side: "A", limitPx: "70", sz: "200", oid: 5, reduceOnly: true, orderType: "Take Profit Market", triggerPx: "70" },
    { coin: "HYPE", side: "A", limitPx: "55", sz: "200", oid: 6, isPositionTpsl: true, orderType: "Stop Market", triggerPx: "55" },
    { coin: "HYPE", side: "B", limitPx: "50", sz: "100", oid: 7, reduceOnly: false, orderType: "Limit" }, // 开仓单忽略
  ];
  const ex = parseExitOrders(orders);
  assert.equal(ex.length, 2);
  assert.equal(ex[0].kind, "TP");
  assert.equal(ex[1].kind, "SL");
});

test("canonicalPositionsFp / canonicalOpenOrdersFp: 排序稳定", () => {
  const ps = [{ coin: "ETH", dir: "SHORT", size: -5 }, { coin: "BTC", dir: "LONG", size: 0.5 }];
  assert.equal(canonicalPositionsFp(ps), "BTC:LONG:0.5,ETH:SHORT:5");
  const orders = [{ oid: 2, limitPx: "70", sz: "1" }, { oid: 1, limitPx: "50", sz: "2" }];
  assert.equal(canonicalOpenOrdersFp(orders), "1:50:2,2:70:1");
});

test("diffExitOrders: PLACE / CANCEL；MODIFY 只认价格变（size 变不报）", () => {
  const prev = new Map([
    [1, { oid: 1, coin: "HYPE", price: 70, size: 200 }],
    [2, { oid: 2, coin: "HYPE", price: 55, size: 200 }],
  ]);
  const curr = [
    { oid: 1, coin: "HYPE", price: 72, size: 200 }, // 价变 → MODIFY
    { oid: 3, coin: "BTC", price: 65000, size: 0.5 }, // 新 → PLACE
    // oid 2 消失 → CANCEL
  ];
  const { placed, modified, canceled } = diffExitOrders(prev, curr);
  assert.deepEqual(placed.map((o) => o.oid), [3]);
  assert.deepEqual(modified.map((o) => o.oid), [1]);
  assert.deepEqual(canceled.map((o) => o.oid), [2]);
});

test("diffExitOrders: 仅 size 变（部分成交）不报 MODIFY", () => {
  const prev = new Map([[1, { oid: 1, coin: "HYPE", price: 70, size: 200 }]]);
  const curr = [{ oid: 1, coin: "HYPE", price: 70, size: 120 }]; // 价不变、量减
  const { placed, modified, canceled } = diffExitOrders(prev, curr);
  assert.equal(placed.length, 0);
  assert.equal(modified.length, 0);
  assert.equal(canceled.length, 0);
});

test("diffPositions: OPENED / CLOSED / INCREASED / DECREASED", () => {
  const prev = [{ coin: "HYPE", dir: "LONG", size: 200, entry: 60 }, { coin: "ETH", dir: "SHORT", size: -5, entry: 1779 }];
  const curr = [{ coin: "HYPE", dir: "LONG", size: 300, entry: 60 }, { coin: "BTC", dir: "LONG", size: 0.5, entry: 65000 }];
  const events = diffPositions(prev, curr);
  assert.ok(events.some((e) => e.startsWith("INCREASED LONG HYPE")));
  assert.ok(events.some((e) => e.startsWith("OPENED LONG BTC")));
  assert.ok(events.some((e) => e.startsWith("CLOSED SHORT ETH")));
});
