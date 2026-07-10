// 每日镜像独立模块：纯 REST 路径，不依赖 WS 状态
// 供 AccountWatcher 和 SnapshotMode 共用
import { fmtTime, formatDisplayId } from "../../tool/format.mjs";
import { reportSkipReason } from "../../tool/reportGate.mjs";
import { baseCoin } from "./parse.mjs";
import { buildTgMessage } from "./render.mjs";
import {
  log, fetchPositionHistory, fetchAccountState, sendTelegram, resolveAccountIdViaChain, ensureSymbolsLoaded,
} from "../api/index.mjs";
import { saveLastPositions } from "../../tool/lastPositionsStore.mjs";

/**
 * 执行每日镜像快照（独立于 WS 事件路径）
 * @param {Object} ctx
 * @param {Object} ctx.env - 环境配置
 * @param {string} ctx.address - 钱包地址
 * @param {string|null} ctx.accountId - 账户 ID（可传 null，内部自动解析）
 * @param {string|null} ctx.tgToken - Telegram Bot Token
 * @param {string|null} ctx.tgChat - Telegram Chat ID
 * @param {string|null} ctx.stateDir - 仓位持久化目录
 * @param {string|null} ctx.label - 标签（用于显示 ID）
 * @param {number} ctx.historyLimit - 平仓历史条数
 * @param {number} [retry=0] - 内部重试计数（调用方不传）
 * @returns {Promise<{accountId: string|null}>}
 */
export async function dailySnapshot(ctx, retry = 0) {
  try {
    // 兜底：独立调用或进程刚启动时符号缓存可能为空（refreshSymbols 失败且尚未重试），
    // 缓存空 → 平仓历史 renderPositionHistory 无法从数字 symbolId 解析币名 → 显示 #xx
    await ensureSymbolsLoaded(ctx.env);

    let accountId = ctx.accountId;
    if (!accountId) {
      accountId = await resolveAccountIdViaChain(ctx.env, ctx.address);
    }

    const [acctState, posHistory] = await Promise.all([
      fetchAccountState(ctx.env, ctx.address),
      accountId ? fetchPositionHistory(ctx.env, accountId) : null,
    ]);

    // 对齐 parseWsPosition 格式，确保 render + diffPositions + saveLastPositions 链路完整
    const positions = (acctState?.positions ?? []).map(p => {
      const size = String(p.sz ?? "0");
      const dir = Number(size) > 0 ? "LONG" : "SHORT";
      return {
        symbol: String(p.s ?? "?"),
        size,
        dir,
        coin: baseCoin(String(p.s ?? "")),
        entry: String(p.ep ?? ""),
        unrealizedPnl: String(p.ur ?? "0"),
        leverage: Number(p.l ?? 0),
        liqPrice: String(p.lp ?? ""),
        marginMode: String(p.m ?? ""),
      };
    });
    const closeRecords = posHistory?.records ?? [];
    const displayId = formatDisplayId(ctx.address, ctx.label);

    const hasOpenPositions = positions.some(p => Math.abs(Number(p.size)) > 0);
    const skipReason = reportSkipReason({ kind: "SNAPSHOT", hasOpenPositions, isNew: false });
    if (skipReason) {
      log(skipReason);
    } else {
      const tgText = buildTgMessage(
        displayId, "SNAPSHOT", fmtTime(),
        positions, [], closeRecords, new Set(), ctx.historyLimit ?? 2,
      );
      await sendTelegram(ctx.tgToken, ctx.tgChat, tgText);
    }

    if (ctx.stateDir && positions.length > 0) {
      saveLastPositions(ctx.stateDir, ctx.address, positions);
    }

    log(`每日镜像完成：${positions.length} 个仓位`);
    return { accountId };
  } catch (e) {
    log(`每日镜像 REST 失败(${e.message})，重试=${retry}`);
    if (retry < 3) {
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
      return dailySnapshot(ctx, retry + 1);
    }
    log('每日镜像 REST 拉取失败（重试 3 次仍失败），跳过');
    return { accountId: ctx.accountId };
  }
}
