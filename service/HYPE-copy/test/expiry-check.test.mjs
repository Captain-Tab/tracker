// expiry-check 纯函数单测（不触网；evaluateExpiry / buildExpiryMessage）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExpiry, buildExpiryMessage } from "../expiry-check.mjs";

const NOW = 1_700_000_000_000; // 固定 now（毫秒），确定性
const d = (days) => NOW + days * 86_400_000;
const agent = (validUntil, name = "hype-copy valid_until X", address = "0xAgentAddr000000000000000000000000000000") => ({ address, name, validUntil });

test("evaluateExpiry: 不在列表（未授权/撤销）→ hit not-found", () => {
  assert.deepEqual(evaluateExpiry([], { nowMs: NOW }), { hit: true, reason: "not-found" });
  // 有别的 agent 但无 hype-copy 前缀 → 仍 not-found
  assert.equal(evaluateExpiry([agent(d(100), "other-bot")], { nowMs: NOW }).reason, "not-found");
});

test("evaluateExpiry: 临期（<7天）→ hit expiring", () => {
  const r = evaluateExpiry([agent(d(5))], { nowMs: NOW });
  assert.equal(r.hit, true);
  assert.equal(r.reason, "expiring");
  assert.ok(Math.abs(r.daysLeft - 5) < 0.001);
});

test("evaluateExpiry: 已过期 → hit expired", () => {
  const r = evaluateExpiry([agent(d(-1))], { nowMs: NOW });
  assert.equal(r.hit, true);
  assert.equal(r.reason, "expired");
});

test("evaluateExpiry: 远离到期 → 不告警 ok", () => {
  const r = evaluateExpiry([agent(d(180))], { nowMs: NOW });
  assert.equal(r.hit, false);
  assert.equal(r.reason, "ok");
});

test("evaluateExpiry: validUntil=null（长期有效）→ 不告警 no-expiry", () => {
  const r = evaluateExpiry([agent(null)], { nowMs: NOW });
  assert.equal(r.hit, false);
  assert.equal(r.reason, "no-expiry");
});

test("evaluateExpiry: 多 agent 取最早到期（最保守）", () => {
  const r = evaluateExpiry([agent(d(180), "hype-copy A"), agent(d(3), "hype-copy B")], { nowMs: NOW });
  assert.equal(r.reason, "expiring");
  assert.ok(Math.abs(r.daysLeft - 3) < 0.001);
});

test("evaluateExpiry: 边界正好 7 天 → 不告警（< 严格小于）", () => {
  assert.equal(evaluateExpiry([agent(d(7))], { nowMs: NOW }).reason, "ok");
});

test("buildExpiryMessage: 三种告警文案", () => {
  assert.match(buildExpiryMessage({ reason: "not-found" }, "demo-1"), /不在授权列表/);
  assert.match(buildExpiryMessage({ reason: "expired", agent: agent(d(-1)) }, "demo-1"), /已过期/);
  assert.match(buildExpiryMessage({ reason: "expiring", agent: agent(d(5)), daysLeft: 5 }, "demo-1"), /将于.*过期.*剩 5\.0 天/);
});
