// provision/hype-copy-approve-agent.mjs 纯函数单测（不触网，makeClient 注入 stub）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { formatAgentName, resolveAgent, approveAgentForCopy } from "./hype-copy-approve-agent.mjs";

const KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const ADDR = privateKeyToAccount(KEY).address; // 已知派生地址

test("formatAgentName: 带/不带 valid_until", () => {
  assert.equal(formatAgentName("hype-copy", null), "hype-copy");
  assert.equal(formatAgentName("hype-copy", 1720000000000), "hype-copy valid_until 1720000000000");
});

test("resolveAgent 模式A: 已有私钥 → 派生地址，私钥附带", () => {
  const r = resolveAgent({ agentKey: KEY });
  assert.equal(r.mode, "A");
  assert.equal(r.agentAddress, ADDR);
  assert.equal(r.agentPrivateKey, KEY);
  assert.equal(r.generated, false);
});

test("resolveAgent 模式B: 只给地址 → 私钥不碰本机（null）", () => {
  const r = resolveAgent({ agentAddress: ADDR });
  assert.equal(r.mode, "B");
  assert.equal(r.agentAddress, ADDR);
  assert.equal(r.agentPrivateKey, null);
  assert.equal(r.generated, false);
});

test("resolveAgent 模式C: 生成新 agent（私钥/地址自洽）", () => {
  const r = resolveAgent({});
  assert.equal(r.mode, "C");
  assert.match(r.agentPrivateKey, /^0x[0-9a-fA-F]{64}$/);
  assert.match(r.agentAddress, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(r.generated, true);
  assert.equal(privateKeyToAccount(r.agentPrivateKey).address, r.agentAddress);
});

test("resolveAgent: 非法私钥/地址抛错", () => {
  assert.throws(() => resolveAgent({ agentKey: "0xbad" }), /agent 私钥/);
  assert.throws(() => resolveAgent({ agentAddress: "0xbad" }), /agent 地址/);
});

test("approveAgentForCopy: 只把 agentAddress + name 传给 client（不碰 agent 私钥）", async () => {
  let captured = null;
  const stub = { approveAgent: async (p) => { captured = p; return { status: "ok", response: { type: "default" } }; } };
  const r = await approveAgentForCopy({
    mainPrivateKey: KEY, agentAddress: ADDR, agentName: "hype-copy valid_until 123",
    makeClient: () => stub,
  });
  assert.equal(captured.agentAddress, ADDR);
  assert.equal(captured.agentName, "hype-copy valid_until 123");
  assert.equal(r.response.status, "ok");
  assert.equal(r.mainAddress, ADDR); // KEY 派生地址
});

test("approveAgentForCopy: response 非 ok 抛错", async () => {
  const stub = { approveAgent: async () => ({ status: "err", response: "nope" }) };
  await assert.rejects(() => approveAgentForCopy({ mainPrivateKey: KEY, agentAddress: ADDR, makeClient: () => stub }), /未成功/);
});

test("approveAgentForCopy: 非法主私钥/地址抛错（不回显密钥）", async () => {
  await assert.rejects(() => approveAgentForCopy({ mainPrivateKey: "bad", agentAddress: ADDR, makeClient: () => ({}) }), /主私钥/);
  await assert.rejects(() => approveAgentForCopy({ mainPrivateKey: KEY, agentAddress: "bad", makeClient: () => ({}) }), /agent 地址/);
});
