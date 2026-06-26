import { describe, it } from "node:test";
import assert from "node:assert";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCandidates, saveCandidates, mergeCandidates, candidateAddresses } from "./watchCandidates.mjs";

const tmp = join(tmpdir(), `wc-test-${Date.now()}.json`);
function cleanup() { try { unlinkSync(tmp); } catch {} }

describe("loadCandidates", () => {
  it("文件缺失 → 空 Map", () => {
    const m = loadCandidates("/no/such/file.json");
    assert.equal(m.size, 0);
  });

  it("合法对象 → 小写归一 Map", () => {
    writeFileSync(tmp, JSON.stringify({
      "0xABC": { "date": "2026-06-23", "reason": "discovery #1" },
      "0xDEF": { "date": "2026-06-24", "reason": "手动添加" }
    }), "utf8");
    const m = loadCandidates(tmp);
    assert.equal(m.size, 2);
    assert.equal(m.get("0xabc").date, "2026-06-23");
    assert.equal(m.get("0xabc").reason, "discovery #1");
    assert.equal(m.get("0xdef").date, "2026-06-24");
    cleanup();
  });

  it("兼容旧格式（纯日期字符串）", () => {
    writeFileSync(tmp, JSON.stringify({ "0xABC": "2026-06-23" }), "utf8");
    const m = loadCandidates(tmp);
    assert.equal(m.size, 1);
    assert.equal(m.get("0xabc").date, "2026-06-23");
    assert.equal(m.get("0xabc").reason, "");
    cleanup();
  });

  it("数组/非法 JSON → 空 Map 不崩", () => {
    writeFileSync(tmp, "[1,2,3]", "utf8");
    assert.equal(loadCandidates(tmp).size, 0);
    writeFileSync(tmp, "not json", "utf8");
    assert.equal(loadCandidates(tmp).size, 0);
    cleanup();
  });
});

describe("saveCandidates", () => {
  it("写后读回一致", () => {
    const m = new Map([
      ["0xabc", { date: "2026-06-23", reason: "discovery #1" }],
      ["0xdef", { date: "2026-06-24", reason: "" }]
    ]);
    saveCandidates(tmp, m);
    const m2 = loadCandidates(tmp);
    assert.equal(m2.size, 2);
    assert.equal(m2.get("0xabc").date, "2026-06-23");
    assert.equal(m2.get("0xabc").reason, "discovery #1");
    assert.equal(m2.get("0xdef").reason, "");
    cleanup();
  });
});

describe("mergeCandidates", () => {
  it("新地址追加，已有地址保留原值", () => {
    const existing = new Map([["0xabc", { date: "2026-06-23", reason: "discovery #1" }]]);
    const next = mergeCandidates(existing, [
      { address: "0xABC", date: "2026-06-26", reason: "no" },
      { address: "0xDEF", date: "2026-06-26", reason: "手动" }
    ]);
    assert.equal(next.size, 2);
    assert.equal(next.get("0xabc").date, "2026-06-23"); // 保持原值
    assert.equal(next.get("0xdef").date, "2026-06-26");
    assert.equal(next.get("0xdef").reason, "手动");
  });

  it("不修改原 map（纯函数）", () => {
    const existing = new Map([["0xabc", { date: "2026-06-23", reason: "test" }]]);
    mergeCandidates(existing, [{ address: "0xDEF", date: "2026-06-26", reason: "" }]);
    assert.equal(existing.size, 1);
  });

  it("空 addrs → 返回副本", () => {
    const existing = new Map([["0xabc", { date: "2026-06-23", reason: "test" }]]);
    const next = mergeCandidates(existing, []);
    assert.equal(next.size, 1);
    assert.notStrictEqual(next, existing);
  });

  it("addrs 缺少 address → 跳过", () => {
    const existing = new Map();
    const next = mergeCandidates(existing, [{ date: "2026-06-26" }]);
    assert.equal(next.size, 0);
  });
});

describe("candidateAddresses", () => {
  it("提取小写地址集", () => {
    const m = new Map([
      ["0xABC", { date: "2026-06-23", reason: "" }],
      ["0xDEF", { date: "2026-06-24", reason: "" }]
    ]);
    const s = candidateAddresses(m);
    assert.equal(s.size, 2);
    assert(s.has("0xabc"));
    assert(s.has("0xdef"));
  });
});
