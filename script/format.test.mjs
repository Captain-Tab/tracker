// 格式化工具严格单测（Node 22 内置 node:test，零依赖）
// 运行: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtNum, fmtUsd, fmtPct, fmtTime, fmtTimeShort, directionCN, derivePositionView,
  canonicalReduceOnlyOrders, toPositionHistoryRecords, positionSideCN, marginModeNumLabel,
  exitOrderLines, diffReduceOnly, isValidHHMM, pickAt, shortAddress, formatDisplayId,
} from "./watch-account.mjs";

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

test("fmtTimeShort: MM/DD HH:mm（去年份/秒）", () => {
  // 1750000000000 → 上海 2025/06/15 23:06:40 → 短格式 06/15 23:06
  assert.equal(fmtTimeShort(1750000000000), "06/15 23:06");
  assert.equal(fmtTimeShort(NaN), "-");
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

// ---------- 每地址镜像时刻 at（HH:MM 校验 + 优先级）----------
test("isValidHHMM: 合法 HH:MM", () => {
  assert.equal(isValidHHMM("20:00"), true);
  assert.equal(isValidHHMM("08:30"), true);
  assert.equal(isValidHHMM("0:00"), true);   // 单位数小时也可
  assert.equal(isValidHHMM("23:59"), true);
});

test("isValidHHMM: 非法值", () => {
  assert.equal(isValidHHMM("24:00"), false); // 小时越界
  assert.equal(isValidHHMM("12:60"), false); // 分钟越界
  assert.equal(isValidHHMM("8"), false);      // 缺分钟
  assert.equal(isValidHHMM("08-30"), false);  // 分隔符错
  assert.equal(isValidHHMM(""), false);
  assert.equal(isValidHHMM(true), false);     // --at 无值时 parseArgs 给 true
  assert.equal(isValidHHMM(undefined), false);
});

test("pickAt: 优先级 地址项 > CLI > 默认 20:00", () => {
  assert.equal(pickAt("08:30", "10:00"), "08:30"); // 地址项优先
  assert.equal(pickAt(undefined, "10:00"), "10:00"); // 回退 CLI
  assert.equal(pickAt(undefined, undefined), "20:00"); // 回退默认
  assert.equal(pickAt("bad", "10:00"), "10:00"); // 地址项非法 → 回退 CLI
  assert.equal(pickAt("bad", "also-bad"), "20:00"); // 都非法 → 默认
  assert.equal(pickAt(true, undefined), "20:00"); // --at 无值 → 默认
});

// ---------- shortAddress ----------
test("shortAddress: 标准以太坊地址缩短", () => {
  assert.equal(shortAddress("0xbeadbf314a7b17140f5964249803d649d5491c8a"), "0xbe...1c8a");
  assert.equal(shortAddress("0x584743497098d00733d5d29fe80e020280427027"), "0x58...7027");
});

test("shortAddress: 短地址原样返回", () => {
  assert.equal(shortAddress("0x1234"), "0x1234");
  assert.equal(shortAddress("abc"), "abc");
});

test("shortAddress: 空/非法 → 占位", () => {
  assert.equal(shortAddress(""), "");
  assert.equal(shortAddress(null), "?");
  assert.equal(shortAddress(undefined), "?");
});

// ---------- formatDisplayId（banner 头 id）----------
test("formatDisplayId: 无 label → 仅【短地址】", () => {
  assert.equal(formatDisplayId("0x584743497098d00733d5d29fe80e020280427027", null), "【0x58...7027】");
  assert.equal(formatDisplayId("0x584743497098d00733d5d29fe80e020280427027", ""), "【0x58...7027】");
});

test("formatDisplayId: 有 label → 【短地址】- label（label 在括号外）", () => {
  assert.equal(formatDisplayId("0x584743497098d00733d5d29fe80e020280427027", "xiao"), "【0x58...7027】- xiao");
});
