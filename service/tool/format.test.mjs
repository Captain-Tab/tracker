// 格式化 / 校验工具严格单测（Node 22 内置 node:test，零依赖）
// 运行: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtNum, fmtUsd, fmtPct, fmtTime, fmtTimeShort, directionCN,
  isValidHHMM, pickAt, shortAddress, formatDisplayId,
} from "./format.mjs";

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

test("formatDisplayId: 有 label → 【短地址】 🎯 label", () => {
  assert.equal(formatDisplayId("0x584743497098d00733d5d29fe80e020280427027", "xiao"), "【0x58...7027】 🎯 xiao");
});
