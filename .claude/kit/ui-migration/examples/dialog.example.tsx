/**
 * 示例：弹窗组件（壳层已剥离 + openXxxDialog 模板）
 *
 * 体现的规则（除 panel/form 共通项外）：
 * - modal-component-style: 根元素只用 w-full，无 p-*/border/rounded/bg-bg-black-*
 * - 无标题 JSX: title 由 openResponsive 的 options.title 传入
 * - 无关闭按钮 JSX: 由 Shell 统一渲染
 * - 导出两样: 内容组件 + open 方法（open + 组件名）
 * - ModalInjectedProps: 需要 close/resolve 时接收，不用则不导入
 * - open 方法封装: openResponsive/openModal/openDrawer 只出现在此文件内
 *
 * 使用方：
 *   import { openFundWalletDialog } from '@/features/fundWallet/components/FundWalletDialog';
 *   openFundWalletDialog({ balance: '100.00' });
 *   // 外部只 import open 方法，不引用内容组件
 */

import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import {
  openResponsive,
  type ModalInjectedProps,
} from '@/shared/infra/modalManager/api';

export interface FundWalletDialogProps extends ModalInjectedProps {
  balance: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  errorText?: string;
  onAmountChange: (value: string) => void;
  onConfirm: () => void;
}

export function FundWalletDialog(props: FundWalletDialogProps) {
  const {
    balance,
    canSubmit,
    isSubmitting,
    errorText,
    onAmountChange,
    onConfirm,
    close,
  } = props;

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <span className="text-[#A3A3A3] text-sm">Available Balance</span>
        <span className="text-white text-base font-medium">{balance}</span>
      </div>

      <Input
        placeholder="Enter amount"
        onChange={(e) => onAmountChange(e.target.value)}
      />

      {errorText && (
        <span className="text-status-down text-xs">{errorText}</span>
      )}

      <div className="flex gap-3">
        <Button
          variant="ghost"
          onClick={() => close?.()}
          className="flex-1 h-12"
        >
          Cancel
        </Button>
        <Button
          disabled={!canSubmit || isSubmitting}
          onClick={onConfirm}
          className="flex-1 h-12"
        >
          {isSubmitting ? 'Processing...' : 'Confirm'}
        </Button>
      </div>
    </div>
  );
}

export interface OpenFundWalletDialogParams {
  balance: string;
}

export function openFundWalletDialog(params: OpenFundWalletDialogParams) {
  return openResponsive({
    title: 'Fund Wallet',
    description: 'Add funds to your trading account',
    content: (ctx) => (
      <FundWalletDialog
        {...ctx}
        balance={params.balance}
        canSubmit={false}
        isSubmitting={false}
        onAmountChange={() => {}}
        onConfirm={() => ctx.resolve?.()}
      />
    ),
  });
}
