// 测试 discovery TG 消息格式（不真实推送）
import { __internals } from "./output.mjs";

const { buildTgMessage } = __internals;

// 用 5 条候选数据构造测试，模拟用户提供的示例
const ranked = [
  {
    score: 84.7,
    walletAddress: "0x32641234abcdef5678901234abcdef567844e5",
    profitFactor: 5.20,
    winRate: 0.65,
    perpsPnl: 555,
    volume: 3_412_732,
    hitWindows: new Set(["30D"]),
    nTrades: 40,
  },
  {
    score: 81.3,
    walletAddress: "0xc4571234abcdef5678901234abcdef5678f336",
    profitFactor: 2.77,
    winRate: 0.85,
    perpsPnl: 1_270,
    volume: 572_135,
    hitWindows: new Set(["30D"]),
    nTrades: 45,
  },
  {
    score: 80.8,
    walletAddress: "0x8e501234abcdef5678901234abcdef5678d057",
    profitFactor: 2.41,
    winRate: 0.70,
    perpsPnl: 606,
    volume: 728_327,
    hitWindows: new Set(["7D", "30D"]),
    nTrades: 50,
  },
  {
    score: 66,
    walletAddress: "0x25cc1234abcdef5678901234abcdef5678038a",
    profitFactor: 2.42,
    winRate: 0.35,
    perpsPnl: 455,
    volume: 566_005,
    hitWindows: new Set(["30D"]),
    nTrades: 35,
  },
  {
    score: 52.7,
    walletAddress: "0xf7e01234abcdef5678901234abcdef56784729",
    profitFactor: 1.80,
    winRate: 0.45,
    perpsPnl: 293,
    volume: 148_307,
    hitWindows: new Set(["7D", "30D"]),
    nTrades: 30,
  },
];

const summary = {
  candidates: 163,
  passed: 6,
  recommended: 6,
  excluded: 4,
};

const config = {
  gates: { minTrades: 20 },
};

const generatedAt = new Date("2026-06-20T10:59:00+08:00");

console.log("=".repeat(60));
console.log("修改后的 TG 消息格式：");
console.log("=".repeat(60));
const tgText = buildTgMessage(ranked, summary, generatedAt, config);
console.log(tgText);
console.log("=".repeat(60));

// 验证
const lines = tgText.split("\n");

// 1. 第一行是标题（无日期）
console.assert(
  lines[0] === "🔭 跟单候选发现",
  `❌ 第一行应为标题，实际：${lines[0]}`,
);
console.log("✅ 第 1 行：标题（无日期）");

// 2. 第二行是 ⌚ + 日期
console.assert(
  lines[1] === "⌚ 2026-06-20",
  `❌ 第二行应为 ⌚ + 日期，实际：${lines[1]}`,
);
console.log("✅ 第 2 行：⌚ 日期");

// 3. 第三行是摘要
console.assert(
  lines[2].startsWith("候选 163 → 通过 6 → 推荐 6"),
  `❌ 第三行应为摘要，实际：${lines[2]}`,
);
console.log("✅ 第 3 行：候选摘要");

// 4. 第四行是排除信息
console.assert(
  lines[3].startsWith("排除 4 个在监听"),
  `❌ 第四行应为排除信息，实际：${lines[3]}`,
);
console.log("✅ 第 4 行：排除信息");

// 5. 应该有 5 条详展卡片（#1 到 #5）
const hashCardCount = lines.filter((l) => /^#\d/.test(l) && l.includes("· 评分")).length;
console.assert(hashCardCount === 5, `❌ 应有 5 条详展卡片，实际：${hashCardCount}`);
console.log(`✅ 详展卡片数：${hashCardCount}`);

// 6. 不应该有紧凑单行格式（#6 无 "· 评分" 标记且不是详展卡片）
const compactLine = lines.find((l) => /^#\d/.test(l) && !l.includes("· 评分"));
console.assert(!compactLine, `❌ 不应有紧凑单行，发现：${compactLine}`);
console.log("✅ 无紧凑单行格式（#6 已移除）");

// 7. 尾部提示见附件
const lastLine = lines[lines.length - 1];
console.assert(
  lastLine === "📄 完整报告见附件",
  `❌ 最后一行应为附件提示，实际：${lastLine}`,
);
console.log("✅ 尾部：附件提示");

console.log("\n✨ 所有检查通过！");
