// seen-addresses 门控单测：computeNewAddresses（纯）+ load/save（tmp 文件往返）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSeenAddresses, computeNewAddresses, saveSeen } from "./seenAddresses.mjs";

test("computeNewAddresses: 仅返回不在 seen 的地址（小写归一）", () => {
  const seen = new Set(["0xaa", "0xbb"]);
  const out = computeNewAddresses(["0xAA", "0xBB", "0xCC"], seen);
  assert.deepEqual([...out], ["0xcc"]); // 只有 CC 是新增；AA/BB 大小写归一后命中
});

test("computeNewAddresses: 空 seen → 全部新增（首次部署）", () => {
  const out = computeNewAddresses(["0xAA", "0xBB"], new Set());
  assert.deepEqual([...out].sort(), ["0xaa", "0xbb"]);
});

test("loadSeenAddresses: 文件缺失 → 空集不崩", () => {
  assert.equal(loadSeenAddresses("/nonexistent/path/.seen.json").size, 0);
});

test("load/save 往返 + 并集（删文件→重置）", () => {
  const dir = mkdtempSync(join(tmpdir(), "seen-"));
  const path = join(dir, ".seen-addresses.json");
  try {
    // 首次：空 seen，保存 [aa,bb]
    saveSeen(path, ["0xAA", "0xBB"], new Set());
    let seen = loadSeenAddresses(path);
    assert.deepEqual([...seen].sort(), ["0xaa", "0xbb"]);

    // 新增 cc：computeNew 仅 cc；保存并集 [aa,bb,cc]
    const newAddrs = computeNewAddresses(["0xAA", "0xBB", "0xCC"], seen);
    assert.deepEqual([...newAddrs], ["0xcc"]);
    saveSeen(path, ["0xAA", "0xBB", "0xCC"], seen);
    seen = loadSeenAddresses(path);
    assert.deepEqual([...seen].sort(), ["0xaa", "0xbb", "0xcc"]);

    // 删文件 → 重置为空 → 全部重新成为新增（强制重推）
    rmSync(path);
    assert.equal(loadSeenAddresses(path).size, 0);
    assert.equal(computeNewAddresses(["0xAA", "0xBB", "0xCC"], loadSeenAddresses(path)).size, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadSeenAddresses: 非数组 JSON → 空集", () => {
  const dir = mkdtempSync(join(tmpdir(), "seen-"));
  const path = join(dir, "bad.json");
  try {
    writeFileSync(path, '{"not":"array"}', "utf8");
    assert.equal(loadSeenAddresses(path).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
