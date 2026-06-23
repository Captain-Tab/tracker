// 报告 TG 推送门控：决定首帧/镜像报告是否跳过 Telegram 推送（console banner 始终打，仅 gate TG）。
// sodex-watch / HYPE-watch 共用。纯函数。
// 返回跳过原因字符串（调用方 log 之）；返回 null 表示应推送。
export function reportSkipReason({ kind, hasOpenPositions, isNew }) {
  // 定时镜像（SNAPSHOT）当前无持仓 → 不推（镜像无意义）
  if (kind === "SNAPSHOT" && !hasOpenPositions) return "定时镜像：当前无持仓，跳过 Telegram 推送";
  // 首帧 START：仅 config 相比上次新增的地址推（避免每次部署对所有地址重推）
  if (kind === "START" && !isNew) return "已知地址，跳过 START WATCH 推送（仅新增地址推）";
  return null;
}
