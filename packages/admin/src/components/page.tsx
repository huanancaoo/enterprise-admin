import { useId, type ComponentProps, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useDocumentTitle } from "../hooks/use-document-title"
import { AppSidebar, type AppSidebarProps } from "./app-sidebar"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { Inbox, LoaderCircle, ShieldAlert, TriangleAlert } from "lucide-react"
import { cn } from "cn"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight wrap-anywhere sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="max-w-3xl text-sm leading-relaxed wrap-anywhere text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}

export interface AppShellProps {
  sidebar: AppSidebarProps
  breadcrumb: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function AppShell({
  sidebar,
  breadcrumb,
  actions,
  children,
}: AppShellProps) {
  const { t, i18n } = useTranslation("common")
  return (
    <TooltipProvider>
      <SidebarProvider
        labels={{
          toggle: t("toggleSidebar"),
          mobileTitle: t("sidebar"),
          mobileDescription: t("sidebarDescription"),
        }}
      >
        <AppSidebar
          {...sidebar}
          side={i18n.dir() === "rtl" ? "right" : "left"}
        />
        {/* 主面板独立滚动，使长页面和侧栏弹层共享稳定的视口坐标。 */}
        <SidebarInset className="h-svh min-h-0 min-w-0 overflow-y-auto">
          <header className="sticky top-0 z-20 flex min-h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur-sm sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 [&_nav]:min-w-0 [&_ol]:gap-1.5 sm:[&_ol]:gap-2.5">
              <SidebarTrigger className="-ms-1" />
              <Separator
                orientation="vertical"
                className="me-2 data-vertical:h-4 data-vertical:self-auto"
              />
              {breadcrumb}
            </div>
            {actions && (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            )}
          </header>
          <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

export function LoadingState() {
  const { t } = useTranslation("common")
  return (
    <div
      role="status"
      aria-busy="true"
      className="min-w-0 space-y-5 rounded-xl border bg-card p-6 sm:p-8"
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {t("loading")}
      </p>
      <div className="max-w-xl space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}
export function EmptyState() {
  const { t } = useTranslation("common")
  return (
    <div
      role="status"
      className="flex min-h-48 min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center"
    >
      <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1.5">
        <h2 className="font-semibold">{t("emptyTitle")}</h2>
        <p className="max-w-md text-sm leading-relaxed wrap-anywhere text-muted-foreground">
          {t("emptyDescription")}
        </p>
      </div>
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
    <div className="flex min-w-0 items-start gap-4 rounded-xl border border-destructive/20 bg-card p-6">
      <TriangleAlert
        className="mt-0.5 size-5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-4">
        <div role="alert" className="space-y-1.5">
          <h2 className="font-semibold">{t("errorTitle")}</h2>
          <p className="text-sm leading-relaxed wrap-anywhere text-muted-foreground">
            {message ?? t("errorDescription")}
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </div>
    </div>
  )
}
export function NotFoundContent() {
  const { t } = useTranslation("common")
  useDocumentTitle(t("notFoundTitle"))
  return (
    <section className="mx-auto w-full max-w-lg space-y-3 rounded-xl border bg-card p-8">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("notFoundTitle")}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("notFoundDescription")}
      </p>
    </section>
  )
}

// 只有独立 404 页面创建主地标；详情和弹层复用内容，主地标由外层布局负责。
export function NotFoundState() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <NotFoundContent />
    </main>
  )
}

export function RouterErrorComponent({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  return (
    <ErrorState
      message={error instanceof Error ? error.message : undefined}
      onRetry={reset}
    />
  )
}

export function PermissionDeniedState() {
  const { t } = useTranslation("common")
  return (
    <div
      role="alert"
      className="flex min-w-0 items-start gap-4 rounded-xl border bg-card p-6"
    >
      <ShieldAlert
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1.5">
        <h2 className="font-semibold">{t("permissionDenied")}</h2>
        <p className="text-sm leading-relaxed wrap-anywhere text-muted-foreground">
          {t("permissionDescription")}
        </p>
      </div>
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
  submitDisabled = false,
  finalFocus,
  onOpenChangeComplete,
  contentClassName,
  contentTabIndex,
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
  submitDisabled?: boolean
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"]
  onOpenChangeComplete?: (open: boolean) => void
  contentClassName?: ComponentProps<typeof DialogContent>["className"]
  contentTabIndex?: ComponentProps<typeof DialogContent>["tabIndex"]
}) {
  const { t } = useTranslation("common")
  const formId = useId()
  return (
    <Dialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value)
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus}
        className={cn(
          "max-h-[calc(100svh-2rem)] overflow-y-auto",
          contentClassName
        )}
        tabIndex={contentTabIndex}
      >
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
          <DialogDescription className="leading-relaxed wrap-anywhere">
            {description}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          aria-busy={pending}
          onSubmit={(event) => {
            // Portal 中的独立表单会沿 React 树冒泡；它的提交不能保存外层业务草稿。
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            onSubmit()
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            {children}
          </fieldset>
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm wrap-anywhere text-destructive"
            >
              {error}
            </p>
          )}
        </form>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={pending || submitDisabled}
          >
            {pending && (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {pending ? t("submitting") : (submitLabel ?? t("save"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
