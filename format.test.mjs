// 格式化工具严格单测（Node 22 内置 node:test，零依赖）
// 运行: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtNum, fmtUsd, fmtPct, fmtTime, directionCN, derivePositionView } from "./watch-account.mjs";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("fmtNum: 去尾零", () => {
  assert.equal(fmtNum(0.6, 6), "0.6");
  assert.equal(fmtNum("0.600000", 6), "0.6");
  assert.equal(fmtNum(0.03, 6), "0.03");
  assert.equal(fmtNum(100, 2), "100"); // 100.00 → 100
});

test("fmtNum: 千分位", () => {
  assert.equal(fmtNum(65820, 2), "65,820");
  assert.equal(fmtNum(1234.5, 2), "1,234.5");
  assert.equal(fmtNum(1234567.89, 2), "1,234,567.89");
});

test("fmtNum: 低价币高精度不被截断", () => {
  assert.equal(fmtNum(0.00001234, 8), "0.00001234");
  assert.equal(fmtNum("0.00024", 6), "0.00024");
});

test("fmtNum: 负数 / 截断到 maxDecimals", () => {
  assert.equal(fmtNum(-1234.5, 2), "-1,234.5");
  assert.equal(fmtNum(1.23456, 2), "1.23"); // 四舍五入到 2 位
});

test("fmtNum: 缺失/非法 → -", () => {
  assert.equal(fmtNum(null, 2), "-");
  assert.equal(fmtNum(undefined, 2), "-");
  assert.equal(fmtNum("", 2), "-");
  assert.equal(fmtNum(NaN, 2), "-");
  assert.equal(fmtNum("abc", 2), "-");
});

test("fmtNum: 0 是合法值", () => {
  assert.equal(fmtNum(0, 2), "0");
});

test("fmtUsd: 基本 / 千分位 / 去尾零", () => {
  assert.equal(fmtUsd(700), "$700");
  assert.equal(fmtUsd(1234.5), "$1,234.5");
  assert.equal(fmtUsd(15.8), "$15.8");
  assert.equal(fmtUsd(0), "$0");
});

test("fmtUsd: 负号在 $ 前", () => {
  assert.equal(fmtUsd(-0.26), "-$0.26");
  assert.equal(fmtUsd(-1234.5), "-$1,234.5");
});

test("fmtUsd: signed 正数加 +", () => {
  assert.equal(fmtUsd(0.26, true), "+$0.26");
  assert.equal(fmtUsd(-0.26, true), "-$0.26");
  assert.equal(fmtUsd(0, true), "$0"); // 0 不带符号
});

test("fmtUsd: 缺失/非法 → -", () => {
  assert.equal(fmtUsd(null), "-");
  assert.equal(fmtUsd(""), "-");
  assert.equal(fmtUsd(NaN), "-");
});

test("fmtPct: 带符号 + 去尾零", () => {
  assert.equal(fmtPct(-41.3), "-41.3%");
  assert.equal(fmtPct(41.3), "+41.3%");
  assert.equal(fmtPct(-41.3042), "-41.3%"); // 2 位
  assert.equal(fmtPct(0), "0%"); // 0 不带符号
});

test("fmtPct: 缺失/非法 → -", () => {
  assert.equal(fmtPct(null), "-");
  assert.equal(fmtPct(NaN), "-");
});

test("fmtTime: 格式 YYYY/MM/DD HH:mm:ss (上海 UTC+8)", () => {
  // 1750000000000 = 2025-06-15T15:06:40Z → 上海(UTC+8) 2025/06/15 23:06:40
  const s = fmtTime(1750000000000);
  assert.match(s, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(s, "2025/06/15 23:06:40");
  assert.ok(!s.includes("-")); // 日期分隔符全为 /
});

test("fmtTime: 缺省取当前(返回合法格式)", () => {
  assert.match(fmtTime(), /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("fmtTime: 非法 → -", () => {
  assert.equal(fmtTime(NaN), "-");
  assert.equal(fmtTime("abc"), "-");
});

test("directionCN: 映射", () => {
  assert.equal(directionCN("LONG"), "做多");
  assert.equal(directionCN("SHORT"), "做空");
  assert.equal(directionCN("BOTH"), "BOTH"); // 透传（实际由 positionDirection 提前解析）
});

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
