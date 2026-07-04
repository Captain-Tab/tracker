// 跟单状态持久化（spec 09 §3.6/§4.3）：baseline 快照 + myPos（含 S0/T0）跨重启恢复。
// 损坏/缺失 → 降级为「未建基线」（baselineCaptured:false），由 main 下轮重新快照当前为 baseline，
// 绝不当新开去跟（安全默认，spec 09 §3.6 铁律）。dry-run 亦落盘以对齐实盘行为。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

// 空状态：未建基线 → main 会重新快照。
function emptyState() {
  return { baselineCaptured: false, baselineCoins: new Set(), myPos: new Map() };
}

function stateFile(stateDir, targetId) {
  return join(stateDir, `HYPE-copy-${targetId}-state.json`);
}

// 读状态：文件缺失/损坏/结构非法 → 返回空状态（降级，不抛）。
export function loadCopyState(stateDir, targetId) {
  try {
    const raw = readFileSync(stateFile(stateDir, targetId), "utf8");
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || j.baselineCaptured !== true) return emptyState();
    const baselineCoins = new Set(Array.isArray(j.baselineCoins) ? j.baselineCoins : []);
    const myPos = new Map();
    if (j.myPos && typeof j.myPos === "object") {
      for (const [coin, p] of Object.entries(j.myPos)) {
        if (p && typeof p === "object") myPos.set(coin, p);
      }
    }
    return { baselineCaptured: true, baselineCoins, myPos };
  } catch {
    return emptyState(); // 缺失/损坏 → 降级
  }
}

// 写状态：Set→数组、Map→对象；原子写（tmp + rename）。
export function saveCopyState(stateDir, targetId, { baselineCaptured, baselineCoins, myPos }) {
  try {
    mkdirSync(stateDir, { recursive: true });
    const payload = {
      baselineCaptured: baselineCaptured === true,
      baselineCoins: [...(baselineCoins instanceof Set ? baselineCoins : [])],
      myPos: Object.fromEntries(myPos instanceof Map ? myPos : []),
    };
    const file = stateFile(stateDir, targetId);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, file);
  } catch (e) {
    console.error(new Date().toISOString().slice(11, 19), `copy state 落盘失败：${e.message}`);
  }
}
