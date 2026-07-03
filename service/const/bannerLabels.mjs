// Banner 文案集中定义：英文 + 中文同行，供 watch / copy 共用。
// 图标（emoji）不在此，由各自 render/templates 按 kind 决定。

// watch 两端（sodex-watch / HYPE-watch）仓位事件 banner
export const WATCH_BANNER_LABEL = {
  START: "START WATCH 开始监控",
  SNAPSHOT: "SNAPSHOT 每日快照",
  OPEN: "OPEN POSITION 开仓",
  CLOSE: "CLOSE POSITION 平仓",
  INCREASE: "INCREASE POSITION 加仓",
  REDUCE: "REDUCE POSITION 减仓",
};

// 离场单变化 banner（按动作细化，同帧同币多种动作回退 mixed）
export const EXIT_ORDER_BANNER_LABEL = {
  place: "ORDER PLACED 挂单设置",
  cancel: "ORDER CANCELED 挂单撤销",
  modify: "ORDER MODIFIED 挂单调整",
  mixed: "OPEN ORDER 挂单变化",
};

// HYPE-copy 跟单轮次动作 banner
export const COPY_BANNER_LABEL = {
  initial_sync: "COPY START 跟单启动",
  startup: "COPY START 跟单启动",
  round_open: "OPEN POSITION 开仓",
  round_close: "CLOSE POSITION 平仓",
  round: "RECONCILE 跟单对账",
  shutdown: "COPY STOP 跟单关闭",
};
