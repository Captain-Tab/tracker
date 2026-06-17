/**
 * 示例：表单组件（含状态分支 + 事件回调）
 *
 * 体现的规则：
 * - use-shared-ui: 原生 HTML 文本输入和按钮标签全部替换为 shared/ui 组件
 * - 条件渲染: {errorText && ...}（状态分支用原 class 包，不新增样式）
 * - 受控组件: value + onChange 由 props 驱动
 * - 事件命名: onXxx（与 migration 的 ViewModel 返回值对齐）
 * - 数据命名: 业务名（amount / balance / errorText），不用 value / text
 * - CLAUDE.md §9: precision 字段用 string（不是 number）
 * - Phase 1 Props 化: disabled 由 canSubmit 派生（逻辑留在 ViewModel）
 *
 * 不体现的规则（见 dialog.example.tsx）：
 * - 弹窗壳层剥离
 * - openXxxDialog 模板
 */

import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';

export interface AmountInputFormProps {
  amount: string;
  balance: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  errorText?: string;
  onAmountChange: (value: string) => void;
  onMaxClick: () => void;
  onSubmit: () => void;
}

export function AmountInputForm(props: AmountInputFormProps) {
  const {
    amount,
    balance,
    canSubmit,
    isSubmitting,
    errorText,
    onAmountChange,
    onMaxClick,
    onSubmit,
  } = props;

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="text-[#A3A3A3] text-sm">Amount</span>
        <span className="text-[#A3A3A3] text-xs">
          Balance: <span className="text-white">{balance}</span>
        </span>
      </div>

      <div className="relative">
        <Input
          value={amount}
          placeholder="0.00"
          onChange={(e) => onAmountChange(e.target.value)}
          className="pr-14"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onMaxClick}
          className="absolute right-2 top-1/2 -translate-y-1/2"
        >
          Max
        </Button>
      </div>

      {errorText && (
        <span className="text-status-down text-xs">{errorText}</span>
      )}

      <Button
        disabled={!canSubmit || isSubmitting}
        onClick={onSubmit}
        className="h-12"
      >
        {isSubmitting ? 'Submitting...' : 'Submit'}
      </Button>
    </div>
  );
}
