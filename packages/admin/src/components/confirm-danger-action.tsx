import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import type { ComponentProps, ReactNode } from "react"

export type ConfirmDangerActionProps = {
  triggerLabel: string
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  pendingLabel: string
  error?: string
  pending?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"]
}

export function ConfirmDangerAction({
  triggerLabel,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  error,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  open,
  onOpenChange,
  children,
  finalFocus,
}: ConfirmDangerActionProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange?.(value)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="destructive"
            className="bg-destructive text-white hover:bg-destructive/90"
          />
        }
      >
        {triggerLabel}
      </AlertDialogTrigger>
      <AlertDialogContent aria-busy={pending} finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
