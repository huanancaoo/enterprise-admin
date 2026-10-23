import { Suspense, useId, type ComponentProps, type ReactNode } from "react"
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

export interface PageHeaderProps {
  title: string
  description?: string
  back?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  /** 弹窗关闭后聚焦标题本身，避免焦点被页头内的操作按钮接走。 */
  headingRef?: ComponentProps<"h1">["ref"]
}

export function PageHeader({
  title,
  description,
  back,
  meta,
  actions,
  headingRef,
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className="min-w-0 space-y-4">
      {back && (
        <div
          data-slot="page-back"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {back}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="font-heading text-2xl font-semibold tracking-tight wrap-anywhere sm:text-3xl"
          >
            {title}
          </h1>
          {description && (
            <p className="max-w-3xl text-sm leading-relaxed wrap-anywhere text-muted-foreground">
              {description}
            </p>
          )}
          {meta && (
            <div className="min-w-0 text-sm wrap-anywhere text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:max-w-1/2">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}

export interface AdminPageProps extends PageHeaderProps {
  children?: ReactNode
  subnav?: ReactNode
  contentWidth?: "standard" | "form" | "reading"
  "aria-busy"?: ComponentProps<"section">["aria-busy"]
}

export function AdminPage({
  children,
  subnav,
  contentWidth = "standard",
  "aria-busy": busy,
  ...header
}: AdminPageProps) {
  useDocumentTitle(header.title)
  return (
    <section
      data-slot="admin-page"
      aria-busy={busy}
      className="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 sm:p-6 lg:p-8"
    >
      <PageHeader {...header} />
      {subnav}
      <div
        data-slot="page-content"
        className={cn(
          "min-w-0 space-y-6",
          contentWidth === "form" && "max-w-3xl",
          contentWidth === "reading" && "max-w-4xl"
        )}
      >
        <Suspense fallback={<LoadingState />}>{children}</Suspense>
      </div>
    </section>
  )
}

export function WorkspacePage({
  children,
  ...header
}: PageHeaderProps & { children: ReactNode }) {
  useDocumentTitle(header.title)
  return (
    <section
      data-slot="workspace-page"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="shrink-0 border-b px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader {...header} />
      </div>
      <div
        data-slot="workspace-content"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
      >
        <Suspense fallback={<LoadingState />}>{children}</Suspense>
      </div>
    </section>
  )
}

export interface AppShellProps {
  sidebar: AppSidebarProps
  breadcrumb: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** 工作区分配剩余视口；全局导航不随业务内容的加载或权限状态卸载。 */
  layout?: "page" | "workspace"
}

export function AppShell({
  sidebar,
  breadcrumb,
  actions,
  children,
  layout = "page",
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
        {/* 外壳固定全局导航；普通页滚动内容，工作区自行分配剩余高度。 */}
        <SidebarInset className="h-svh min-h-0 min-w-0 overflow-hidden">
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
          <div
            data-slot="page-scroll"
            className={cn(
              "flex min-h-0 w-full min-w-0 flex-1 flex-col",
              layout === "workspace" ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
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
  return (
    <section className="mx-auto w-full max-w-lg space-y-3 rounded-xl border bg-card p-8">
      <h2 className="font-heading text-xl font-semibold tracking-tight">
        {t("notFoundTitle")}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("notFoundDescription")}
      </p>
    </section>
  )
}

// 只有独立 404 页面创建主地标；详情和弹层复用内容，主地标由外层布局负责。
export function NotFoundState() {
  const { t } = useTranslation("common")
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <AdminPage title={t("notFoundTitle")}>
        <NotFoundContent />
      </AdminPage>
    </main>
  )
}

export function RouterNotFoundComponent() {
  const { t } = useTranslation("common")
  return (
    <AdminPage title={t("notFoundTitle")}>
      <NotFoundContent />
    </AdminPage>
  )
}

export function RouterErrorComponent({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  const { t } = useTranslation("common")
  return (
    <AdminPage title={t("errorTitle")}>
      <ErrorState
        message={error instanceof Error ? error.message : undefined}
        onRetry={reset}
      />
    </AdminPage>
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
