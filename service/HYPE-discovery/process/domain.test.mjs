// HYPE-discovery 纯函数单测：流式 scanner 鲁棒性 + flatten + 门槛/排序/topK。
import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenRow } from "./collect.mjs";
import { passesThreshold, rankTopK, windowMetric } from "./filter.mjs";
import { createRowScanner } from "../api/index.mjs";
import { __internals as evalInternals } from "./evaluate.mjs";
import { __internals as obsInternals } from "./observing.mjs";

// ---------- 流式 scanner ----------
const LB = '{"leaderboardRows":[' +
  '{"ethAddress":"0xAA","accountValue":"100","displayName":"a}b{c]","windowPerformances":[["month",{"pnl":"5","roi":"0.1","vlm":"9"}]]},' +
  '{"ethAddress":"0xBB","accountValue":"200","displayName":"quote\\"and\\\\slash","windowPerformances":[["day",{"pnl":"1","roi":"0","vlm":"2"}]]}' +
  ']}';

test("createRowScanner: 逐字符喂入（最毒 chunk 边界）仍正确抽出 2 行", () => {
  const scanner = createRowScanner();
  const rows = [];
  for (const ch of LB) rows.push(...scanner.push(ch));
  assert.equal(rows.length, 2);
  const a = JSON.parse(rows[0]);
  const b = JSON.parse(rows[1]);
  assert.equal(a.ethAddress, "0xAA");
  assert.equal(a.displayName, "a}b{c]"); // 字符串内的 }{] 不破坏花括号配对
  assert.equal(b.displayName, 'quote"and\\slash'); // 转义引号/反斜杠不破坏字符串态
});

test("createRowScanner: 一次性整块喂入也正确", () => {
  const scanner = createRowScanner();
  const rows = scanner.push(LB);
  assert.equal(rows.length, 2);
});

test("createRowScanner: 空 leaderboardRows → 0 行不崩", () => {
  const scanner = createRowScanner();
  const rows = scanner.push('{"leaderboardRows":[]}');
  assert.equal(rows.length, 0);
});

// ---------- flatten ----------
test("flattenRow: 展平 + address 小写归一", () => {
  const c = flattenRow({
    ethAddress: "0xABCDEF0000000000000000000000000000000001",
    accountValue: "57553324.03", displayName: null,
    windowPerformances: [["month", { pnl: "1028504.24", roi: "0.0127", vlm: "40474716783.38" }]],
  });
  assert.equal(c.address, "0xabcdef0000000000000000000000000000000001");
  assert.equal(c.perf.month.pnl, 1028504.24);
  assert.equal(c.accountValue, 57553324.03);
});

test("flattenRow: 缺 ethAddress → null", () => {
  assert.equal(flattenRow({ accountValue: "1" }), null);
  assert.equal(flattenRow(null), null);
});

// ---------- 门槛 + 排序 ----------
const mk = (addr, pnl, vlm) => ({ address: addr, accountValue: 1, perf: { month: { pnl, roi: 0.1, vlm } } });
const CFG = { window: "month", thresholds: { minPnlUsd: { month: 100000 }, minVlmUsd: { month: 5000000 } }, topK: 2 };

test("passesThreshold: pnl/vlm 双门槛", () => {
  assert.equal(passesThreshold(mk("a", 200000, 8000000), CFG), true);
  assert.equal(passesThreshold(mk("c", 50000, 9000000), CFG), false); // pnl 不足
  assert.equal(passesThreshold(mk("d", 300000, 1000000), CFG), false); // vlm 不足
});

test("passesThreshold: 窗口缺失 / NaN → false 不崩", () => {
  assert.equal(passesThreshold({ address: "x", perf: {} }, CFG), false);
  assert.equal(passesThreshold({ address: "y", perf: { month: { pnl: NaN, vlm: 9e6 } } }, CFG), false);
  assert.equal(windowMetric({ perf: {} }, "month"), null);
});

test("rankTopK: pnl 降序 + topK 截断 + truncated 计数", () => {
  const survivors = [mk("a", 200000, 8e6), mk("b", 500000, 9e6), mk("e", 300000, 9e6)];
  const { ranked, truncated } = rankTopK(survivors, CFG);
  assert.equal(ranked.length, 2); // topK=2
  assert.deepEqual(ranked.map((c) => c.address), ["b", "e"]); // pnl 降序
  assert.equal(truncated, 1); // a 被截断
});

test("passesThreshold: 门槛缺省为 0（全通过）", () => {
  assert.equal(passesThreshold(mk("a", 1, 1), { window: "month", thresholds: {}, topK: 20 }), true);
});

// ---------- aggregateTrades 周期净额 = Σ(closedPnl − fee)（锁定 fee 符号修复）----------
test("aggregateTrades: 一个完整周期 pnl = closedPnl 累加 − fee 累加", () => {
  const fills = [
    // 开多：startPosition 0 → +10，未平
    { coin: "HYPE", side: "B", sz: "10", px: "100", startPosition: "0", closedPnl: "0", fee: "1", time: 1 },
    // 平多：startPosition 10 → 0，周期结束
    { coin: "HYPE", side: "A", sz: "10", px: "110", startPosition: "10", closedPnl: "100", fee: "1", time: 2 },
  ];
  const trades = evalInternals.aggregateTrades(fills);
  assert.equal(trades.length, 1);
  // 正确：(0−1)+(100−1)=98；若退回 +fee bug 则为 102
  assert.equal(trades[0].pnl, 98);
  assert.equal(trades[0].fills, 2);
});

test("aggregateTrades: 未平仓周期不计入", () => {
  const fills = [{ coin: "BTC", side: "B", sz: "1", px: "60000", startPosition: "0", closedPnl: "0", fee: "5", time: 1 }];
  assert.equal(evalInternals.aggregateTrades(fills).length, 0); // endPos=1≠0，未结束
});

// ---------- minLiquidationDistance 距强平价 ----------
test("minLiquidationDistance: 空单距强平 = (liq-cur)/cur", () => {
  const state = { assetPositions: [{ position: { szi: "-10", liquidationPx: "110", positionValue: "1000" } }] };
  // 当前价 = |value|/|szi| = 100；空单涨到 110 爆 → (110-100)/100 = 0.1
  assert.ok(Math.abs(obsInternals.minLiquidationDistance(state) - 0.1) < 1e-9);
});

test("minLiquidationDistance: 多单距强平 = (cur-liq)/cur", () => {
  const state = { assetPositions: [{ position: { szi: "10", liquidationPx: "90", positionValue: "1000" } }] };
  // 当前价 = 100；多单跌到 90 爆 → (100-90)/100 = 0.1
  assert.ok(Math.abs(obsInternals.minLiquidationDistance(state) - 0.1) < 1e-9);
});

test("minLiquidationDistance: 多仓位取最危险（最小距强平）", () => {
  const state = { assetPositions: [
    { position: { szi: "-10", liquidationPx: "110", positionValue: "1000" } }, // 空单 dist 0.1
    { position: { szi: "10", liquidationPx: "95", positionValue: "1000" } },   // 多单 dist 0.05
  ] };
  assert.ok(Math.abs(obsInternals.minLiquidationDistance(state) - 0.05) < 1e-9);
});

test("minLiquidationDistance: 空仓 / 无有效强平价 → null", () => {
  assert.equal(obsInternals.minLiquidationDistance({ assetPositions: [] }), null);
  assert.equal(obsInternals.minLiquidationDistance({}), null);
  const bad = { assetPositions: [{ position: { szi: "10", liquidationPx: "0", positionValue: "1000" } }] };
  assert.equal(obsInternals.minLiquidationDistance(bad), null); // liq=0 跳过 → 无有效值
});

test("minLiquidationDistance: 真实样本回归（0xc6877a HYPE 空单 5x）", () => {
  const state = { assetPositions: [{ position: { szi: "-9400.18", liquidationPx: "361.9334211885", positionValue: "709440.9847800001" } }] };
  const dist = obsInternals.minLiquidationDistance(state);
  assert.ok(dist > 3.7 && dist < 3.9, `期望 ~3.796，实际 ${dist}`); // 距强平 ~379.6%，非濒爆
});

// ---------- isAccountEmpty 账户清空 ----------
test("isAccountEmpty: 无持仓 + 净值 0 → true", () => {
  const state = { assetPositions: [], marginSummary: { accountValue: "0" } };
  assert.equal(obsInternals.isAccountEmpty(state), true);
});

test("isAccountEmpty: 无持仓 + 净值负 → true", () => {
  const state = { assetPositions: [], marginSummary: { accountValue: "-12.5" } };
  assert.equal(obsInternals.isAccountEmpty(state), true);
});

test("isAccountEmpty: 无持仓 + 净值正 → false（只是空仓，未清空）", () => {
  const state = { assetPositions: [], marginSummary: { accountValue: "5000" } };
  assert.equal(obsInternals.isAccountEmpty(state), false);
});

test("isAccountEmpty: 有持仓 + 净值 0 → false（持仓未清）", () => {
  const state = { assetPositions: [{ position: { szi: "10" } }], marginSummary: { accountValue: "0" } };
  assert.equal(obsInternals.isAccountEmpty(state), false);
});

test("isAccountEmpty: 缺 marginSummary / assetPositions → 空账 true", () => {
  assert.equal(obsInternals.isAccountEmpty({}), true); // 无持仓无净值 → 清空
  assert.equal(obsInternals.isAccountEmpty({ marginSummary: { accountValue: "0" } }), true);
});

// 现货余额修正：合约平仓转现货 ≠ 清空（回归 bug：只判合约误杀 $441 万现货地址）
test("isAccountEmpty: 合约空 + 现货有余额 → false（资金转现货，未清空）", () => {
  const state = { assetPositions: [], marginSummary: { accountValue: "0" } };
  const spotState = { balances: [{ coin: "USDC", total: "4410553.57" }] };
  assert.equal(obsInternals.isAccountEmpty(state, spotState), false);
});

test("isAccountEmpty: 合约空 + 现货粉尘余额 → true（≤0.01 视为空）", () => {
  const state = { assetPositions: [], marginSummary: { accountValue: "0" } };
  const spotState = { balances: [{ coin: "USDC", total: "0.005" }] };
  assert.equal(obsInternals.isAccountEmpty(state, spotState), true);
});

test("isAccountEmpty: 合约空 + 现货余额 0 → true（真清空）", () => {
  const state = { assetPositions: [], marginSummary: { accountValue: "0" } };
  const spotState = { balances: [{ coin: "USDC", total: "0" }] };
  assert.equal(obsInternals.isAccountEmpty(state, spotState), true);
});
