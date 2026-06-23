// 报告 TG 门控单测：SNAPSHOT 无持仓跳过 / START 已知地址跳过 / 其余推送。
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportSkipReason } from "./reportGate.mjs";

test("SNAPSHOT 无持仓 → 跳过", () => {
  assert.match(reportSkipReason({ kind: "SNAPSHOT", hasOpenPositions: false, isNew: true }), /无持仓/);
});

test("SNAPSHOT 有持仓 → 推送（null）", () => {
  assert.equal(reportSkipReason({ kind: "SNAPSHOT", hasOpenPositions: true, isNew: true }), null);
});

test("START 已知地址（isNew=false）→ 跳过", () => {
  assert.match(reportSkipReason({ kind: "START", hasOpenPositions: true, isNew: false }), /START WATCH/);
});

test("START 新增地址（isNew=true）→ 推送（null）", () => {
  assert.equal(reportSkipReason({ kind: "START", hasOpenPositions: false, isNew: true }), null);
});

test("普通事件（OPEN/CLOSE 等）→ 始终推送（null）", () => {
  assert.equal(reportSkipReason({ kind: "OPEN", hasOpenPositions: true, isNew: false }), null);
  assert.equal(reportSkipReason({ kind: "CLOSE", hasOpenPositions: false, isNew: false }), null);
});
