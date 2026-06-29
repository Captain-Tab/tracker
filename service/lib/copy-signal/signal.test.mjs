// copy-signal 单测（Node node:test）。运行: node --test service/lib/copy-signal/signal.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { encodeSignal, decodeSignal, writeSignal, isFreshSignal, watchSignal, makeSingleFlight } from "./index.mjs";

test("encode/decode roundtrip + 非法 → null", () => {
  const sig = { seq: 3, ts: 1700000000000, address: "0xabc" };
  assert.deepEqual(decodeSignal(encodeSignal(sig)), sig);
  assert.equal(decodeSignal("{bad"), null);
  assert.equal(decodeSignal(JSON.stringify({ address: "0x" })), null); // 缺 ts
  assert.equal(decodeSignal(JSON.stringify({ ts: 1, address: 1 })), null); // address 非串
});

test("isFreshSignal: ts 严格大于才算新", () => {
  assert.equal(isFreshSignal({ ts: 100 }, 50), true);
  assert.equal(isFreshSignal({ ts: 50 }, 50), false); // 相等不算新（去重）
  assert.equal(isFreshSignal({ ts: 10 }, 50), false);
  assert.equal(isFreshSignal(null, 0), false);
});

test("writeSignal 原子写 + 读回一致", () => {
  const dir = mkdtempSync(join(tmpdir(), "sig-"));
  const path = join(dir, "demo.json");
  writeSignal(path, { seq: 1, ts: 1700000000001, address: "0xfff" });
  const back = decodeSignal(readFileSync(path, "utf8"));
  assert.equal(back.seq, 1);
  assert.equal(back.address, "0xfff");
});

// 集成：watchSignal 监听 + 原子 rename 连续覆盖仍触发（场景3）+ ts 去重
test("watchSignal: 原子 rename 后仍触发 + ts 去重", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sigw-"));
  const path = join(dir, "demo.json");
  const got = [];
  const stop = watchSignal(path, (sig) => got.push(sig.ts), { interval: 20 });
  try {
    writeSignal(path, { seq: 1, ts: 1000, address: "0xa" });
    await waitUntil(() => got.length >= 1, 2000);
    writeSignal(path, { seq: 2, ts: 2000, address: "0xa" }); // 原子 rename 覆盖
    await waitUntil(() => got.length >= 2, 2000);
    writeSignal(path, { seq: 3, ts: 2000, address: "0xa" }); // ts 同 → 去重不触发
    await sleep(120);
    assert.deepEqual(got, [1000, 2000], `应只触发 ts=1000/2000，实得 ${got}`);
  } finally { stop(); }
});

test("makeSingleFlight: 并发 burst 合并为 2 次（首跑 + 补跑一次）", async () => {
  let runs = 0;
  const trigger = makeSingleFlight(async () => { runs++; await sleep(50); });
  // 跑中连发 5 次：第 1 次启动，其余合并为 1 次补跑 → 共 2 次
  trigger(); trigger(); trigger(); trigger(); trigger();
  await sleep(200);
  assert.equal(runs, 2, `应合并为 2 次，实得 ${runs}`);
});

test("makeSingleFlight: 串行（前一次结束后再触发）正常各跑一次", async () => {
  let runs = 0;
  const trigger = makeSingleFlight(async () => { runs++; await sleep(10); });
  await trigger();
  await trigger();
  assert.equal(runs, 2);
});

async function waitUntil(cond, timeoutMs) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil 超时");
    await sleep(20);
  }
}
