/**
 * 翻译白名单配置
 * 
 * 这里配置的词汇不会被自动翻译（在 rules.js 基础上扩展）
 * 支持：
 * - 字符串：精确匹配
 * - 正则表达式：模式匹配
 */

module.exports = [
  // 品牌名
  "SoDEX",
  "SosoValue",
  
  // 代币符号
  "USDC",
  "USDT",
  "ETH",
  "BTC",
  "WETH",
  "WBTC",
  
  // 版本号（V1、V2、V3 等）
  /^V\d+$/i,

  // 特殊单词
  "SoPoints",

  // 金融术语缩写（保持英文）
  "ROI",
  "APY",
  "APR",
  "TVL",
  
  // 可根据需要添加更多...
];
