/**
 * 示例：简单展示面板（Panel）
 *
 * 体现的规则：
 * - use-shared-ui: 禁用原生 HTML 交互标签
 * - figma-style-mapping: text-status-up / text-[#A3A3A3] 等 CSS var class
 * - CLAUDE.md §9: 禁硬编码颜色、禁 Tailwind 暗色前缀
 * - Phase 1 Props 化: 内嵌 interface，事件用 onXxx，数据用业务名
 * - ui-migration: 组件只接 props，不含 useState / useEffect / store import
 *
 * 不体现的规则（见 form.example.tsx / dialog.example.tsx）：
 * - 状态分支 / 条件渲染
 * - 弹窗壳层剥离 / openXxxDialog
 */

import { Image } from '@/shared/components/ui/Image';

export interface MarketOverviewPanelProps {
  symbol: string;
  lastPrice: string;
  changePercent: string;
  changeDirection: 'up' | 'down' | 'flat';
  logoUrl: string;
  onClick: () => void;
}

export function MarketOverviewPanel(props: MarketOverviewPanelProps) {
  const { symbol, lastPrice, changePercent, changeDirection, logoUrl, onClick } = props;

  const changeColorClass =
    changeDirection === 'up'
      ? 'text-status-up'
      : changeDirection === 'down'
        ? 'text-status-down'
        : 'text-[#A3A3A3]';

  return (
    <div
      className="w-full flex items-center gap-3 p-4 bg-[#1A1A1A] rounded-lg cursor-pointer"
      onClick={onClick}
    >
      <Image src={logoUrl} alt={symbol} className="w-8 h-8 rounded-full" />

      <div className="flex flex-col flex-1 gap-1">
        <span className="text-white text-base font-medium">{symbol}</span>
        <span className="text-[#A3A3A3] text-xs">Market</span>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="text-white text-base font-medium">{lastPrice}</span>
        <span className={`text-xs ${changeColorClass}`}>{changePercent}</span>
      </div>
    </div>
  );
}
