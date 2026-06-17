# 弹窗使用模式

## MyDialog（基础弹窗）

位于 `@/components/my/MyDialog`，基于 Radix Dialog 封装。

尺寸配置：`sm`(425px) / `md`(557px) / `lg`(900px) / `xl`(1200px) / `full`(95vw)

```tsx
<MyDialog open={open} onOpenChange={setOpen} title="标题" size="md"
  showFooter buttons={[
    { text: "取消", onClick: () => setOpen(false), variant: "outline" },
    { text: "确认", onClick: handleConfirm, variant: "primary" },
  ]}
>
  {children}
</MyDialog>
```

## ConfirmDialog（确认弹窗）

位于 `@/components/customize/ConfirmDialog`，用于删除/危险操作二次确认。

```tsx
<ConfirmDialog
  open={deleteDialogOpen}
  onOpenChange={setDeleteDialogOpen}
  title="确认删除"
  description="此操作不可恢复。"
  variant="destructive"
  loading={deleting}
  onConfirm={handleDelete}
  onCancel={() => setDeleteDialogOpen(false)}
/>
```

## SubmitDialog / SubmitModal（带原因输入的提交弹窗）

SubmitDialog 基于 MyDialog 封装，SubmitModal 基于原生 Dialog 原语构建，两者都内置 Textarea 收集原因。
SubmitModal 使用 ghost 变体取消按钮，风格略有不同。推荐使用 SubmitDialog。

```tsx
<SubmitDialog
  open={open} onOpenChange={setOpen}
  title="提交审核" description="申请下线"
  placeholder="请输入原因"
  onConfirm={(reason) => handleSubmit(reason)}
  onCancel={() => setOpen(false)}
  loading={submitting}
/>
```

## MfaInputDialog（MFA 验证弹窗）

位于 `@/components/customize/MfaInputDialog`，用于敏感操作前的 MFA 验证码输入。
输入 6 位验证码后自动触发 `onConfirm`，失败自动清空并显示错误。

```tsx
<MfaInputDialog
  open={mfaOpen}
  onOpenChange={setMfaOpen}
  onConfirm={async (code) => { await verifyAndExecute(code); setMfaOpen(false); }}
  loading={verifying}
  error={mfaError}
/>
```
