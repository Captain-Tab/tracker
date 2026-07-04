// Agent wallet 到期检查（server 端每日 timer 触发的 oneshot，独立进程，只读 extraAgents，无签名无密钥）。
// 设计见 docs/copy/agent-wallet.md §八 / spec 2026-07-04-agent-expiry-notify.md。
// B1 纯查询：validUntil 实时查、零存储、临期每天催、续签自停。dry-run（无 masterAddress）→ 静默跳过。
// 反应式（执行器签名失败→安全态）不在此，属 Part B（配合 B-3）。
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { fileURLToPath } from "node:url";
import { installFetchProxy } from "../lib/WARP/index.mjs";
import { loadTargets } from "./process/mapping.mjs";
import { sendTelegram } from "./notify/index.mjs";

await installFetchProxy(); // VPS 走 WARP；本地无 proxy 时 no-op（import 不发网络）

export const WARN_DAYS = 7;
export const MATCH_PREFIX = "hype-copy"; // approve 设的 agentName 前缀（Q1-A 名称匹配）
const DAY_MS = 86_400_000;

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), "[copy:expiry]", ...a);
const shortAddr = (a) => (typeof a === "string" && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "?");

// 纯函数：据 extraAgents 结果判断是否需告警（不触网，可单测）。
// agents: [{address, name, validUntil(ms|null)}]；opts: {matchPrefix, nowMs, warnDays}
// 返回 {hit, reason, agent?, daysLeft?}：reason ∈ not-found|expired|expiring|ok|no-expiry
export function evaluateExpiry(agents, { matchPrefix = MATCH_PREFIX, nowMs, warnDays = WARN_DAYS } = {}) {
  const list = Array.isArray(agents) ? agents : [];
  const ours = list.filter((a) => typeof a?.name === "string" && a.name.startsWith(matchPrefix));
  if (ours.length === 0) return { hit: true, reason: "not-found" }; // 未授权/已撤销/过期被移除
  const withExp = ours.filter((a) => a.validUntil != null);
  if (withExp.length === 0) return { hit: false, reason: "no-expiry", agent: ours[0] }; // 长期有效，不告警
  const soonest = withExp.reduce((m, a) => (Number(a.validUntil) < Number(m.validUntil) ? a : m)); // 多 agent 取最早到期（最保守）
  const daysLeft = (Number(soonest.validUntil) - nowMs) / DAY_MS;
  if (daysLeft <= 0) return { hit: true, reason: "expired", agent: soonest, daysLeft };
  if (daysLeft < warnDays) return { hit: true, reason: "expiring", agent: soonest, daysLeft };
  return { hit: false, reason: "ok", agent: soonest, daysLeft };
}

// 纯函数：告警文案。
export function buildExpiryMessage(result, id) {
  const at = result.agent?.validUntil != null ? new Date(Number(result.agent.validUntil)).toISOString() : "?";
  const addr = result.agent?.address ? shortAddr(result.agent.address) : "?";
  if (result.reason === "not-found") return `⚠️ [跟单 ${id}] agent 不在授权列表（未授权/已撤销/已过期被移除）→ 请本地 approve/renew`;
  if (result.reason === "expired") return `🔴 [跟单 ${id}] agent ${addr} 已过期（${at}）→ 立即本地 renew，否则无法下单/平仓`;
  if (result.reason === "expiring") return `⚠️ [跟单 ${id}] agent ${addr} 将于 ${at} 过期（剩 ${result.daysLeft.toFixed(1)} 天）→ 请本地 renew`;
  return "";
}

function parseArgs(argv) {
  const f = {};
  for (const a of argv) if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); f[k] = v === undefined ? true : v; }
  return f;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const configPath = flags.config ?? "service/HYPE-copy/targets.json";
  // 配置非法（含实盘缺 masterAddress，loadTargets 会拒）→ 退出非零，触发 OnFailure 告警（监控自身坏了要知道）
  let cfg;
  try { cfg = loadTargets(configPath); }
  catch (e) { console.error(`expiry-check 配置读取失败: ${e.message}`); process.exit(1); }

  const { tgToken, target } = cfg;
  if (!target.masterAddress) { log("无 masterAddress（dry-run 无 agent），跳过检查"); return; }

  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: flags.testnet === true }) });
  let agents;
  try { agents = await info.extraAgents({ user: target.masterAddress }); }
  catch (e) { log(`查询 extraAgents 失败，跳过本次（次日重试）: ${e.message}`); return; } // 网络瞬时失败 → 不告警不崩

  const result = evaluateExpiry(agents, { nowMs: Date.now() });
  if (!result.hit) { log(`agent 正常（${result.reason}${result.daysLeft != null ? `, 剩 ${result.daysLeft.toFixed(1)} 天` : ""}）`); return; }
  log(`告警（${result.reason}）→ TG`);
  await sendTelegram(tgToken, target.tgChat, buildExpiryMessage(result, target.id));
}

// 仅直接运行时执行（被单测 import 时不触发）；非预期错误 → 退出 1 触发 OnFailure 告警
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("expiry-check 失败:", e.message); process.exit(1); });
}
