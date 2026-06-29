// 跟单变化信号（跨进程脏标）：watch 写 / copy 读。零依赖（node:fs）。
// 契约 SSOT：{ seq:int, ts:epochMs, address:string }。
// 触发 gate = mtime 变（fs.watchFile 原生）；seq/ts 仅去重——用 ts（epoch 单调，跨 watch 重启递增）
// 防 fs.watchFile 偶发重复回调，**不**用 seq>lastSeq 当 gate（watch 重启 seq 归零会漏信号）。
import { writeFileSync, renameSync, readFileSync, watchFile, unwatchFile, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function encodeSignal(sig) {
  return JSON.stringify({ seq: Number(sig.seq ?? 0), ts: Number(sig.ts ?? 0), address: String(sig.address ?? "") });
}

// 解析失败 / 字段非法 → null（下游靠返回值分流，不抛错）
export function decodeSignal(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    if (!Number.isFinite(Number(o.ts)) || typeof o.address !== "string") return null;
    return { seq: Number(o.seq ?? 0), ts: Number(o.ts), address: o.address };
  } catch { return null; }
}

// 原子写：tmp + rename（POSIX 原子覆盖，防 copy 读到半截）
export function writeSignal(path, sig) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, encodeSignal(sig));
  renameSync(tmp, path);
  return path;
}

// 去重判定（纯）：ts 比上次大才算新信号（fs.watchFile 偶发重复回调 / 同内容重写时跳过）
export function isFreshSignal(decoded, lastTs) {
  return decoded != null && Number.isFinite(Number(decoded.ts)) && Number(decoded.ts) > Number(lastTs ?? 0);
}

// single-flight：同时只允许一个 fn 在跑；跑中再触发只置 pending，结束补跑一次（run-latest）。
// 防信号回调 ∥ 180s 兜底定时器并发进 reconcile（并发会覆盖 state / 双记录 /（实盘）双下单）。
// 补跑不传 args——fn 自己 re-fetch 最新态（对账幂等），中间触发合并为"结束后再跑一次"。
export function makeSingleFlight(fn) {
  let running = false;
  let pending = false;
  return async function trigger() {
    if (running) { pending = true; return; }
    running = true;
    try {
      do { pending = false; await fn(); } while (pending);
    } finally { running = false; }
  };
}

// 监听信号文件：fs.watchFile 轮询 stat（对原子 rename 免疫——盯路径非 inode）。
// mtime/size 变 → 读 → ts 去重 → onChange(sig)。返回 stop()。
export function watchSignal(path, onChange, { interval = 1000 } = {}) {
  let lastTs = 0;
  const listener = (curr, prev) => {
    // mtime gate：未变化不处理（watch 起始首回调 curr==prev 也跳过）
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    let raw;
    try { raw = readFileSync(path, "utf8"); } catch { return; } // 文件暂缺/读失败 → 等下次轮询
    const sig = decodeSignal(raw);
    if (!isFreshSignal(sig, lastTs)) return;
    lastTs = sig.ts;
    onChange(sig);
  };
  watchFile(path, { interval, persistent: true }, listener);
  return () => unwatchFile(path, listener);
}
