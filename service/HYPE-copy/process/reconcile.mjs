// 收敛对账纯逻辑：diffDelta（净仓做差，非逐 fill）+ planReconcile（顺序铁律编排）。
// 总纲 §2.2 顺序：算 desired → diffDelta → decideLeg 校验门 → 仅 place 进 would-place。
// 精度走 precision.mjs（禁裸 parseFloat）。下单 px/sz 字符串化在 placeDryRun（api）。
import { sub, add, mul, signOf, absStr } from "./precision.mjs";
import { decideLeg, legSideOf } from "./risk.mjs";

// diffDelta(desired[], current[]) → delta[]：按净仓做差（coin = desired ∪ current）。
// dry-run current 恒空 → delta 即 desired 全量（每轮 first-class would-place）。
// 天然吸收滚仓中间态：只看最新 desired 与 current 做差，一步对齐（滚仓三层之①）。
export function diffDelta(desired, current) {
  const desiredMap = new Map((Array.isArray(desired) ? desired : []).filter((d) => d && d.coin && d.size != null).map((d) => [d.coin, String(d.size)]));
  const currentMap = new Map((Array.isArray(current) ? current : []).filter((c) => c && c.coin).map((c) => [c.coin, String(c.size ?? "0")]));
  const coins = new Set([...desiredMap.keys(), ...currentMap.keys()]);
  const out = [];
  for (const coin of coins) {
    const targetDesiredSize = desiredMap.get(coin) ?? "0";
    const currentSize = currentMap.get(coin) ?? "0";
    const deltaSize = sub(targetDesiredSize, currentSize);
    out.push({ coin, deltaSize, side: signOf(deltaSize), targetDesiredSize, currentSize });
  }
  return out;
}

// planReconcile(desired[], current[], caps, prices) → { actions[] }
// actions 每项：{ coin, decision, deltaSize, isBuy, reduceOnly, desiredSize, currentSize, refPx }
// 顺序铁律：先 diffDelta，再逐仓 decideLeg；place 项可直接喂 placeDryRun（main 注入 assetMeta）。
export function planReconcile(desired, current, caps, prices) {
  const currentByCoin = new Map((Array.isArray(current) ? current : []).filter((c) => c && c.coin).map((c) => [c.coin, c]));
  const deltas = diffDelta(desired, current);
  const desiredByCoin = new Map((Array.isArray(desired) ? desired : []).filter((d) => d && d.coin).map((d) => [d.coin, d]));

  const actions = [];
  // 跨腿累加已部署名义：place 的加仓腿计入，使后续加仓腿能正确触发 capped（总纲 §3.3 部署上限）。
  let deployed = String(caps?.currentDeployedNotional ?? "0");
  for (const d of deltas) {
    const desiredLeg = desiredByCoin.get(d.coin) ?? { coin: d.coin, size: d.targetDesiredSize };
    const cur = currentByCoin.get(d.coin) ?? null;
    const decision = decideLeg(desiredLeg, cur, { ...caps, currentDeployedNotional: deployed }, prices);
    const { isBuy, reduceOnly } = legSideOf(d.deltaSize, d.targetDesiredSize, d.currentSize);
    const price = prices?.[d.coin];
    if (decision === "place" && isBuy && price != null) {
      deployed = add(deployed, mul(absStr(d.targetDesiredSize), String(price)));
    }
    actions.push({
      coin: d.coin,
      decision,
      deltaSize: d.deltaSize,
      isBuy,
      reduceOnly,
      desiredSize: d.targetDesiredSize,
      currentSize: d.currentSize,
      refPx: prices?.[d.coin] ?? null,
      size: absStr(d.deltaSize), // 下单量级（方向走 isBuy）
    });
  }
  return { actions };
}
