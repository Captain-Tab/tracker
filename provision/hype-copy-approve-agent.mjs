// Agent Wallet 授权 / 续签（本地一次性 provisioning，禁止部署到服务器 / 禁止被 service import）。
// 设计与安全见 docs/copy/agent-wallet.md。用主钱包私钥在本地签一次 approveAgent(agentAddress)。
// 三模式：A 已有 agent 私钥（派生地址）/ B 只有 agent 地址（私钥不碰本机）/ C 生成新 agent。
// 主私钥：stdin 隐藏输入、仅内存、用完即弃、不进日志。agent 私钥：只打印不落盘。
// 用法：
//   node provision/hype-copy-approve-agent.mjs                    模式C：生成新 agent
//   node provision/hype-copy-approve-agent.mjs --agent-key=0x..   模式A：已有 agent 私钥
//   node provision/hype-copy-approve-agent.mjs --agent-address=0x.. 模式B：只给地址
//   ... --renew --agent-address=0x..                             续签（禁生成，换新有效期）
//   ... --expire-days=180 | --no-expire | --testnet | --name=hype-copy | --id=demo-1
import { HttpTransport, ExchangeClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const RE_PRIV = /^0x[0-9a-fA-F]{64}$/;
const RE_ADDR = /^0x[0-9a-fA-F]{40}$/;
const DAY_MS = 86_400_000;

// ---------- 纯函数（可 mock 单测）----------

// agentName + 可选 valid_until 后缀（HL 解析后缀作到期时间；毫秒时间戳）。
export function formatAgentName(baseName, validUntilMs) {
  const name = String(baseName || "hype-copy").trim();
  if (validUntilMs == null) return name;
  return `${name} valid_until ${Math.trunc(Number(validUntilMs))}`;
}

// 解析 agentAddress 来源（三模式）。授权只需地址，agent 私钥仅在 A/C 附带返回供你落盘。
export function resolveAgent({ agentKey, agentAddress } = {}) {
  if (agentKey) {
    if (!RE_PRIV.test(agentKey)) throw new Error("agent 私钥格式非法（应为 0x + 64 hex）");
    return { mode: "A", agentAddress: privateKeyToAccount(agentKey).address, agentPrivateKey: agentKey, generated: false };
  }
  if (agentAddress) {
    if (!RE_ADDR.test(agentAddress)) throw new Error("agent 地址格式非法（应为 0x + 40 hex）");
    return { mode: "B", agentAddress, agentPrivateKey: null, generated: false };
  }
  const pk = generatePrivateKey();
  return { mode: "C", agentAddress: privateKeyToAccount(pk).address, agentPrivateKey: pk, generated: true };
}

function defaultMakeClient({ account, isTestnet }) {
  const transport = new HttpTransport({ isTestnet });
  return new ExchangeClient({ transport, wallet: account });
}

// 核心：用主钱包签 approveAgent。只吃 agentAddress（不吃 agent 私钥）。makeClient 可注入以单测。
export async function approveAgentForCopy({ mainPrivateKey, agentAddress, agentName, isTestnet = false, makeClient = defaultMakeClient }) {
  if (!RE_PRIV.test(String(mainPrivateKey || ""))) throw new Error("主私钥格式非法（应为 0x + 64 hex）");
  if (!RE_ADDR.test(String(agentAddress || ""))) throw new Error("agent 地址格式非法（应为 0x + 40 hex）");
  const account = privateKeyToAccount(mainPrivateKey);
  const client = makeClient({ account, isTestnet });
  const response = await client.approveAgent({ agentAddress, agentName: agentName || "" });
  if (response?.status && response.status !== "ok") throw new Error(`approveAgent 未成功: ${JSON.stringify(response)}`);
  return { response, mainAddress: account.address, agentAddress };
}

// ---------- CLI（密钥 IO，不进纯函数）----------

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    }
  }
  return flags;
}

// 隐藏输入（不回显，支持 TTY 与管道）。仅内存，调用方用完不持有。
function readSecret(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText, () => {}); // 显式 flush，避免缓冲吞提示
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // 静默回显
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

function ask(promptText) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (a) => { rl.close(); resolve(a.trim()); });
  });
}

async function cli() {
  const flags = parseArgs(process.argv.slice(2));
  const isTestnet = flags.testnet === true;
  const renew = flags.renew === true;
  const baseName = flags.name || "hype-copy";
  const id = flags.id || "<id>";
  const expireDays = flags["no-expire"] === true ? null : Number(flags["expire-days"] ?? 180);
  if (expireDays != null && !(expireDays > 0)) throw new Error("--expire-days 必须为正数，或用 --no-expire");

  const resolved = resolveAgent({ agentKey: flags["agent-key"], agentAddress: flags["agent-address"] });
  if (renew && resolved.generated) throw new Error("renew 模式禁止生成新 agent：请传 --agent-key 或 --agent-address（续签已有 agent）");

  const validUntilMs = expireDays == null ? null : Date.now() + expireDays * DAY_MS;
  const agentName = formatAgentName(baseName, validUntilMs);
  const net = isTestnet ? "测试网 Testnet" : "主网 Mainnet";

  console.log(`\n${renew ? "续签" : "授权"} agent wallet`);
  console.log(`  网络     : ${net}`);
  console.log(`  模式     : ${resolved.mode}${resolved.generated ? "（生成新 agent）" : resolved.mode === "A" ? "（已有 agent 私钥）" : "（只给地址）"}`);
  console.log(`  agent 地址: ${resolved.agentAddress}`);
  console.log(`  名称     : ${agentName}`);
  console.log(`  有效期   : ${validUntilMs ? `${new Date(validUntilMs).toISOString()}（${expireDays} 天）` : "长期不过期（不推荐）"}`);

  let mainKey = await readSecret("\n主钱包私钥（输入不回显）: ");
  // 兼容 Ethereum 私钥格式：64字符纯 hex 自动补 0x
  if (/^[0-9a-fA-F]{64}$/.test(mainKey)) mainKey = "0x" + mainKey;
  if (!RE_PRIV.test(mainKey)) {
    const preview = mainKey.length > 20 ? `${mainKey.slice(0, 20)}...（总长${mainKey.length}）` : mainKey || "(空)";
    throw new Error(`主私钥格式非法（应为 0x + 64 hex，共 66 字符）。收到: ${preview}`);
  }
  const mainAddr = privateKeyToAccount(mainKey).address;
  console.log(`  主钱包地址: ${mainAddr}`);

  const confirm = await ask(`\n确认在【${net}】用上述主钱包授权该 agent？输入 yes 继续: `);
  if (confirm !== "yes") { console.log("已取消。"); return; }

  const { response } = await approveAgentForCopy({ mainPrivateKey: mainKey, agentAddress: resolved.agentAddress, agentName, isTestnet });
  console.log(`\n✅ ${renew ? "续签" : "授权"}成功（status: ${response?.status ?? "ok"}）`);

  if (resolved.agentPrivateKey) {
    console.log(`\n⚠️ agent 私钥（只显示一次，放服务器后请 clear 清屏）:`);
    console.log(`   ${resolved.agentPrivateKey}`);
  }
  console.log(`\n下一步（服务器上执行）:`);
  console.log(`   echo '${resolved.agentPrivateKey ?? "<你的agent私钥>"}' | sudo tee /etc/tracker/HYPE-copy-${id}-agent.key >/dev/null`);
  console.log(`   sudo chmod 600 /etc/tracker/HYPE-copy-${id}-agent.key`);
  console.log(`   sudo chown trader-exec /etc/tracker/HYPE-copy-${id}-agent.key`);
  console.log(`\nagent 地址 ${resolved.agentAddress} 可在 HL 前端核对/撤销；到期前用 --renew 续签。`);
}

// 仅直接运行时执行 CLI（被单测 import 时不触发）
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  cli().catch((e) => { console.error("❌", e.message); process.exit(1); });
}
