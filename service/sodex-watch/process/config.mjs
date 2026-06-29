// 多地址配置加载与校验。
import { readFileSync } from "node:fs";
import { isAddress, isValidHHMM } from "../../tool/format.mjs";

// G8：缺失 / 解析失败 / watches 空 → exit(1)；非法 address 跳过告警；重复 address 去重保首个。
export function loadConfig(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { console.error(`配置文件读取失败：${path}（${e.message}）`); process.exit(1); }
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) { console.error(`配置文件 JSON 解析失败：${e.message}`); process.exit(1); }
  const watches = Array.isArray(cfg.watches) ? cfg.watches : [];
  if (!watches.length) { console.error("配置文件 watches 为空"); process.exit(1); }
  const seen = new Set();
  const valid = [];
  for (const w of watches) {
    if (!w || !isAddress(w.address)) { console.error(`跳过非法 address：${w?.address}`); continue; }
    const key = w.address.toLowerCase();
    if (seen.has(key)) { console.error(`跳过重复 address：${w.address}`); continue; }
    if (w.at !== undefined && !isValidHHMM(w.at)) console.error(`地址 ${w.address} 的 at="${w.at}" 非法（应为 HH:MM），回退默认 20:00`);
    seen.add(key);
    valid.push(w);
  }
  if (!valid.length) { console.error("配置文件无有效 address"); process.exit(1); }
  // copySignalDir（可选）：配了则 watch 在仓位变化时向 <dir>/<address>.json 写跟单脏标信号（加法）。
  return { tgToken: cfg.tgToken ?? null, copySignalDir: cfg.copySignalDir ?? null, watches: valid };
}
