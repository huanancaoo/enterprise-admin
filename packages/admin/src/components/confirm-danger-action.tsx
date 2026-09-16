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

export type ConfirmDangerActionProps = {
  triggerLabel: string
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  pendingLabel: string
  error?: string
  pending?: boolean
  onConfirm: () => void
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
  onConfirm,
}: ConfirmDangerActionProps) {
  return (
    <AlertDialog>
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
      <AlertDialogContent aria-busy={pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
