import { useId, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { MenuIcon } from "lucide-react"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="text-2xl font-semibold wrap-anywhere">{title}</h1>
        {description && (
          <p className="wrap-anywhere text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}

export function AppShell({
  title,
  navigation,
  workspace,
  actions,
  children,
}: {
  title: string
  navigation: ReactNode
  workspace?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation("common")
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-svh min-w-0 bg-background text-foreground">
      <aside
        className="hidden w-64 shrink-0 space-y-6 border-e p-5 md:block"
        aria-label={t("navigation")}
      >
        <p className="font-semibold wrap-anywhere">{title}</p>
        {workspace}
        <nav aria-label={t("navigation")}>{navigation}</nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-4 border-b p-4">
          <Button
            variant="outline"
            size="icon"
            className="md:hidden"
            aria-label={t("openNavigation")}
            onClick={() => setOpen(true)}
          >
            <MenuIcon />
          </Button>
          <p className="min-w-0 flex-1 font-medium wrap-anywhere md:hidden">
            {title}
          </p>
          {actions && <div className="ms-auto">{actions}</div>}
        </header>
        <main className="min-w-0 space-y-6 p-4 md:p-8">{children}</main>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("navigation")}</DialogDescription>
          </DialogHeader>
          {workspace}
          <nav aria-label={t("navigation")} onClick={() => setOpen(false)}>
            {navigation}
          </nav>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("close")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function LoadingState() {
  const { t } = useTranslation("common")
  return (
    <div role="status" aria-busy="true" className="space-y-3 py-8">
      <p>{t("loading")}</p>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  )
}
export function EmptyState() {
  const { t } = useTranslation("common")
  return (
    <div role="status" className="space-y-2 py-12 text-center">
      <h2 className="font-semibold">{t("emptyTitle")}</h2>
      <p className="text-muted-foreground">{t("emptyDescription")}</p>
    </div>
  )
}
export function ErrorState({
  onRetry,
  message,
}: {
  onRetry?: () => void
  message?: string
}) {
  const { t } = useTranslation("common")
  return (
    <div className="space-y-3 py-8">
      <div role="alert">
        <h2 className="font-semibold">{t("errorTitle")}</h2>
        <p className="wrap-anywhere">{message ?? t("errorDescription")}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  )
}
export function PermissionDeniedState() {
  const { t } = useTranslation("common")
  return (
    <div role="alert" className="space-y-2 py-8">
      <h2 className="font-semibold">{t("permissionDenied")}</h2>
      <p>{t("permissionDescription")}</p>
    </div>
  )
}

export function FilterBar({
  children,
  onApply,
  pending = false,
}: {
  children: ReactNode
  onApply: () => void
  pending?: boolean
}) {
  const { t } = useTranslation("common")
  return (
    <form
      aria-label={t("filters")}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault()
        onApply()
      }}
    >
      {/* 筛选请求进行中仍要能改条件；禁用输入会打断正在输入的名称。 */}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </form>
  )
}

// 仅编排已有列表状态，不持有查询、路由或表格状态。
export function ResourceList({
  title,
  actions,
  filters,
  status,
  error,
  onRetry,
  children,
}: {
  title: string
  actions?: ReactNode
  filters?: ReactNode
  status: "ready" | "loading" | "empty" | "error" | "denied"
  error?: string
  onRetry?: () => void
  children?: ReactNode
}) {
  return (
    <section className="min-w-0 space-y-6">
      <PageHeader title={title} actions={actions} />
      {filters}
      {status === "loading" && (children ?? <LoadingState />)}
      {status === "empty" && <EmptyState />}
      {status === "error" && <ErrorState message={error} onRetry={onRetry} />}
      {status === "denied" && <PermissionDeniedState />}
      {status === "ready" && children}
    </section>
  )
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  pending = false,
  error,
  submitLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  onSubmit: () => void
  pending?: boolean
  error?: string
  submitLabel?: string
}) {
  const { t } = useTranslation("common")
  const formId = useId()
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value)
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            {children}
          </fieldset>
          {error && (
            <p role="alert" className="mt-3 wrap-anywhere text-destructive">
              {error}
            </p>
          )}
        </form>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? t("submitting") : (submitLabel ?? t("save"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
