// lastPositionsStore 持久化工具单测（08-position-persistence §5）
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { loadLastPositions, saveLastPositions } from "../../tool/lastPositionsStore.mjs";

const addr = "0x267b408d84ff9546bc92e25d53e0137c7e952566";
const addr2 = "0x5df2fed8188902f86f2074b70fd36ed3a39a1256";

test("lastPositionsStore: 写读往返（单文件内多仓位）", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-test-"));
  try {
    const positions = [
      { coin: "xyz:BB", dir: "SHORT", size: -1969, entry: "11.7" },
      { coin: "BTC", dir: "LONG", size: 1, entry: "61714" },
    ];
    saveLastPositions(dir, addr, positions);
    const loaded = loadLastPositions(dir, addr);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].coin, "xyz:BB");
    assert.equal(loaded[0].size, -1969);
    assert.equal(loaded[1].coin, "BTC");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lastPositionsStore: 空仓写读（覆盖旧文件）", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-test-"));
  try {
    saveLastPositions(dir, addr, [{ coin: "ETH", dir: "LONG", size: 10 }]);
    saveLastPositions(dir, addr, []); // 空仓覆盖
    const loaded = loadLastPositions(dir, addr);
    assert.equal(loaded.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lastPositionsStore: 多地址隔离", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-test-"));
  try {
    saveLastPositions(dir, addr, [{ coin: "BTC", dir: "LONG", size: 1 }]);
    saveLastPositions(dir, addr2, [{ coin: "SOL", dir: "LONG", size: 100 }]);
    assert.equal(loadLastPositions(dir, addr).length, 1);
    assert.equal(loadLastPositions(dir, addr)[0].coin, "BTC");
    assert.equal(loadLastPositions(dir, addr2).length, 1);
    assert.equal(loadLastPositions(dir, addr2)[0].coin, "SOL");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lastPositionsStore: 文件缺失 → 空数组", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-test-"));
  try {
    assert.equal(loadLastPositions(dir, addr).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lastPositionsStore: 损坏 JSON → 空数组", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-test-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lastPositions-267b408d84ff9546bc92e25d53e0137c7e952566.json"), "{broken");
    assert.equal(loadLastPositions(dir, addr).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
