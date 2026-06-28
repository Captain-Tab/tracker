// HYPE-copy 纯函数单测（Node 22 内置 node:test，零依赖）。运行: node --test service/HYPE-copy/test/domain.test.mjs
// 阶段 1：mapSymbol（sodex 映射表 / hype 直通）+ loadTargets（单目标校验 + 默认值填充）。
// 后续阶段追加 case 到本文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapSymbol, loadTargets } from "../process/mapping.mjs";

const ADDR = "0x321f7193eadbacb67eff00f76b975a487e5b1c84";

// 写一份临时 targets.json，返回路径（loadTargets 读文件，单测需落盘）。
function writeTargets(obj) {
  const dir = mkdtempSync(join(tmpdir(), "hype-copy-"));
  const path = join(dir, "targets.json");
  writeFileSync(path, typeof obj === "string" ? obj : JSON.stringify(obj));
  return path;
}

function singleTarget(extra = {}) {
  return {
    tgToken: "tok",
    targets: [{ id: "t1", source: { platform: "sodex", address: ADDR }, exchange: "hype", ...extra }],
  };
}

// ---------- mapSymbol ----------
test("mapSymbol: sodex 源可映射，归一为大写 coin", () => {
  assert.equal(mapSymbol("ETH-USD", "sodex"), "ETH");
  assert.equal(mapSymbol("BTC/USDC", "sodex"), "BTC");
  assert.equal(mapSymbol("eth-usd", "sodex"), "ETH"); // 大小写归一
  assert.equal(mapSymbol("  sol-usd  ", "sodex"), "SOL"); // 去空白
});

test("mapSymbol: sodex 源不可映射（股票/商品 perp）返回 null", () => {
  assert.equal(mapSymbol("PLTR-USD", "sodex"), null);
  assert.equal(mapSymbol("USTECH-USD", "sodex"), null);
  assert.equal(mapSymbol("XAUT-USD", "sodex"), null);
  assert.equal(mapSymbol("COPPER-USD", "sodex"), null);
  assert.equal(mapSymbol("pltr-usd", "sodex"), null); // 大小写归一后命中黑名单
});

test("mapSymbol: hype 源同所直通", () => {
  assert.equal(mapSymbol("ETH", "hype"), "ETH");
  assert.equal(mapSymbol("BTC", "hype"), "BTC");
  assert.equal(mapSymbol("PLTR", "hype"), "PLTR"); // hype 直通不过黑名单
});

test("mapSymbol: 非法入参安全返回 null（不抛错）", () => {
  assert.equal(mapSymbol(null, "sodex"), null);
  assert.equal(mapSymbol("", "sodex"), null);
  assert.equal(mapSymbol("   ", "sodex"), null);
  assert.equal(mapSymbol(123, "hype"), null);
  assert.equal(mapSymbol(undefined, "hype"), null);
});

// ---------- loadTargets ----------
test("loadTargets: 单目标返回 {tgToken, target} + 默认值填充", () => {
  const path = writeTargets(singleTarget());
  const { tgToken, target } = loadTargets(path);
  assert.equal(tgToken, "tok");
  assert.equal(target.id, "t1");
  assert.equal(target.initialDeployPct, 0.5);
  assert.equal(target.maxDeployPct, 0.9);
  assert.equal(target.sizeMultiplier, 1);
  assert.equal(target.dryRun, true);
});

test("loadTargets: 显式字段不被默认值覆盖", () => {
  const path = writeTargets(singleTarget({ initialDeployPct: 0.3, dryRun: true, maxDeployPct: 0.8 }));
  const { target } = loadTargets(path);
  assert.equal(target.initialDeployPct, 0.3);
  assert.equal(target.maxDeployPct, 0.8);
});

test("loadTargets: ≥2 目标抛错，信息含「单目标」", () => {
  const cfg = singleTarget();
  cfg.targets.push({ id: "t2", source: { platform: "hype", address: ADDR }, exchange: "hype" });
  const path = writeTargets(cfg);
  assert.throws(() => loadTargets(path), /单目标/);
});

test("loadTargets: 缺/非法 source.address 抛错", () => {
  const path = writeTargets(singleTarget({ source: { platform: "sodex", address: "0xnope" } }));
  assert.throws(() => loadTargets(path), /address/);
});

test("loadTargets: 缺 id 抛错", () => {
  const path = writeTargets({ tgToken: "tok", targets: [{ source: { platform: "sodex", address: ADDR }, exchange: "hype" }] });
  assert.throws(() => loadTargets(path), /id/);
});

test("loadTargets: exchange 非 hype 抛错", () => {
  const path = writeTargets(singleTarget({ exchange: "sodex" }));
  assert.throws(() => loadTargets(path), /hype/);
});

test("loadTargets: 空 targets 数组抛错", () => {
  const path = writeTargets({ tgToken: "tok", targets: [] });
  assert.throws(() => loadTargets(path), /非空/);
});

test("loadTargets: JSON 解析失败抛错", () => {
  const path = writeTargets("{ not json");
  assert.throws(() => loadTargets(path), /解析失败/);
});

test("loadTargets: tgToken 缺失不抛错，返回 null", () => {
  const path = writeTargets({ targets: [{ id: "t1", source: { platform: "sodex", address: ADDR }, exchange: "hype" }] });
  const { tgToken } = loadTargets(path);
  assert.equal(tgToken, null);
});
