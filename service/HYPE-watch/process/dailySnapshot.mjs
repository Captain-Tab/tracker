// 每日镜像独立模块：纯 REST 路径，不依赖 WS 状态
// 供 AccountWatcher 共用
import { fmtTime, formatDisplayId } from "../../tool/format.mjs";
import { reportSkipReason } from "../../tool/reportGate.mjs";
import { parsePositions, parseCloseRecords } from "./parse.mjs";
import { buildTgMessage } from "./render.mjs";
import {
  log, fetchClearinghouseState, fetchUserFills, sendTelegram, szDecimalsOf,
} from "../api/index.mjs";
import { saveLastPositions } from "../../tool/lastPositionsStore.mjs";

/**
 * 执行每日镜像快照（独立于 WS 事件路径）
 * @param {Object} ctx
 * @param {Object} ctx.env - 环境配置
 * @param {string} ctx.address - 钱包地址
 * @param {string|null} ctx.tgToken - Telegram Bot Token
 * @param {string|null} ctx.tgChat - Telegram Chat ID
 * @param {string|null} ctx.stateDir - 仓位持久化目录
 * @param {string|null} ctx.label - 标签（用于显示 ID）
 * @param {number} ctx.historyLimit - 平仓历史条数
 * @param {number} [retry=0] - 内部重试计数
 */
export async function dailySnapshot(ctx, retry = 0) {
  try {
    const [csNative, csXyz, fills] = await Promise.all([
      fetchClearinghouseState(ctx.env, ctx.address),
      fetchClearinghouseState(ctx.env, ctx.address, "xyz"),
      fetchUserFills(ctx.env, ctx.address),
    ]);
    const nativePositions = parsePositions(csNative?.assetPositions, szDecimalsOf);
    const xyzPositions = parsePositions(csXyz?.assetPositions, szDecimalsOf);
    const positions = [...nativePositions, ...xyzPositions];
    const closeRecords = parseCloseRecords(fills);
    const displayId = formatDisplayId(ctx.address, ctx.label);
    const hasOpen = positions.length > 0;

    const skipReason = reportSkipReason({ kind: "SNAPSHOT", hasOpenPositions: hasOpen, isNew: false });
    if (skipReason) {
      log(skipReason);
    } else {
      const tgText = buildTgMessage(
        displayId, "SNAPSHOT", fmtTime(),
        positions, [], closeRecords, new Set(), ctx.historyLimit ?? 1, [],
      );
      await sendTelegram(ctx.tgToken, ctx.tgChat, tgText);
    }

    if (ctx.stateDir && positions.length > 0) {
      saveLastPositions(ctx.stateDir, ctx.address, positions);
    }

    log(`每日镜像完成：native=${nativePositions.length} xyz=${xyzPositions.length}`);
  } catch (e) {
    log(`每日镜像 REST 失败(${e.message})，重试=${retry}`);
    if (retry < 3) {
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
      return dailySnapshot(ctx, retry + 1);
    }
    log('每日镜像 REST 拉取失败（重试 3 次仍失败），跳过');
  }
}
