// 配置加载 + 标的映射（阶段 1，纯逻辑叶子模块）。
// loadTargets：读 targets.json + 单目标硬限制 + 默认值填充（抛 Error 供 main 捕获 / 单测）。
// mapSymbol：sodex 源走映射表（跨所，黑名单排除不可映射），hype 源同所直通（coin→coin）。
// 详见 spec auto-copy-trade/01-config-mapping.md；契约以总纲 00-overview.md 为准。
import { readFileSync } from "node:fs";
import { isAddress } from "../../tool/format.mjs";

// targets 可选字段默认值（总纲 §3.1 注释）；dryRun 一期恒真。
const TARGET_DEFAULTS = {
  initialDeployPct: 0.5,
  maxDeployPct: 0.9,
  dryRun: true,
};

// sodex 源不可映射集合：hype 无对应的股票/商品 perp。命中即「hype 无对应标的」→ null。
// 采黑名单而非全量白名单：hype 加密 perp 命名与 sodex 基础币高度一致，覆盖已知例外即可，
// 避免漏配新上线币种被误跳过（设计取舍见 spec 01）。后续可扩充。
const UNMAPPABLE = new Set(["PLTR", "USTECH", "XAUT", "COPPER"]);

// 取基础币：split 掉 -/ 后缀，去空白转大写（eth-usd / ETH/USDC → ETH）。与 sodex-watch baseCoin 同源。
function baseCoinUpper(symbol) {
  return String(symbol).split(/[-/]/)[0].trim().toUpperCase();
}

// hype universe 存在性判定：支持 Set / Map（buildHypeAssetIndex 返回 Map<coin,…>）/ 数组；
// 未提供或类型未知 → 不拦（安全回退，向后兼容 2 参调用）。
function universeHas(hypeUniverse, coin) {
  if (hypeUniverse == null) return true;
  if (hypeUniverse instanceof Set || hypeUniverse instanceof Map) return hypeUniverse.has(coin);
  if (Array.isArray(hypeUniverse)) return hypeUniverse.includes(coin);
  return true;
}

// (srcSymbol, srcPlatform, hypeUniverse?) → hypeCoin | null。任意非法入参安全返回 null，不抛错。
// hypeUniverse（可选）：提供时校验 coin 是否在 hype 当前 universe，不在 → null（不可映射，随上下架自动跟）。
export function mapSymbol(srcSymbol, srcPlatform, hypeUniverse) {
  if (typeof srcSymbol !== "string" || !srcSymbol.trim()) return null;
  const coin = baseCoinUpper(srcSymbol);
  if (!coin) return null;

  // sodex 源跨所：黑名单排除不可映射（股票/商品 perp）；hype 源同所直通，跳过黑名单。
  if (srcPlatform !== "hype" && UNMAPPABLE.has(coin)) return null;

  // hype universe 存在性校验（提供时）：不在当前 universe → 不可映射；
  // 未接入（2 参调用）→ 直通（向后兼容）。
  if (!universeHas(hypeUniverse, coin)) return null;

  return coin;
}

// (path) → { tgToken, target }；解析 / 结构 / 单目标 / 必填校验失败均抛 Error。
export function loadTargets(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`targets.json 读取失败: ${e.message}`);
  }

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`targets.json 解析失败: ${e.message}`);
  }

  const targets = Array.isArray(cfg.targets) ? cfg.targets : null;
  if (!targets || targets.length === 0) {
    throw new Error("targets.json 必须包含非空 targets 数组");
  }
  if (targets.length > 1) {
    throw new Error("一期仅支持单目标（N:1 净额收敛未实现）");
  }

  const target = targets[0];
  if (!target || typeof target !== "object") {
    throw new Error("targets.json 的 target 必须是对象");
  }
  if (typeof target.id !== "string" || !target.id.trim()) {
    throw new Error("target.id 不能为空");
  }
  if (!target.source || !isAddress(target.source.address)) {
    throw new Error(`target.source.address 非法: ${target.source?.address}`);
  }
  if (target.exchange !== "hype") {
    throw new Error(`target.exchange 必须为 "hype"（执行所恒 hype），当前: ${target.exchange}`);
  }

  return { tgToken: cfg.tgToken ?? null, target: { ...TARGET_DEFAULTS, ...target } };
}
