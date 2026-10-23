import { usePlatformTaskMessages } from "./task-messages"
import { useEffect, useRef, useState } from "react"
import { useRouteContext } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { LoadingState, ErrorState, AdminPage } from "@workspace/admin"
import {
  listPlatformTasks,
  getPlatformTask,
  getPlatformTaskResult,
} from "@workspace/api-client"
import {
  PlatformTaskSchema,
  PlatformTaskPageSchema,
  type PlatformTask,
} from "@workspace/contracts/platform-tasks"
import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { platformTaskKeys, savePlatformDownload } from "./task-utils"

export type PlatformTasksSearch = {
  page: number
  pageSize: number
  taskId?: string
}
const columns = createDataTableColumnHelper<PlatformTask>()
function active(status: PlatformTask["status"]) {
  return status === "pending" || status === "queued" || status === "running"
}
export function PlatformTasksPage({
  search,
  onSearchChange,
}: {
  search: PlatformTasksSearch
  onSearchChange: (next: PlatformTasksSearch) => void
}) {
  const { t } = useTranslation(["platformTasks", "common"])
  const user = useAuthenticatedSession()!.user
  const locale = useUiLocale()
  const query = useQuery({
    queryKey: [
      ...platformTaskKeys.scope(user.id),
      "list",
      search.page,
      search.pageSize,
    ],
    queryFn: async ({ signal }) =>
      PlatformTaskPageSchema.parse(
        (
          await listPlatformTasks(
            { page: search.page, pageSize: search.pageSize },
            { signal }
          )
        ).data
      ),
    retry: false,
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data?.items.some((item) => active(item.status))
          ? 1500
          : false,
  })
  usePlatformAccessFailure(query.error)
  const resources: Record<string, string> = {
    employees: t("employee"),
    roles: t("role"),
    posts: t("post"),
    dictionaries: t("dictionary"),
    "dictionary-items": t("dictionaryItem"),
    parameters: t("parameter"),
    "audit-events": t("audit"),
    "login-events": t("login"),
    users: t("user"),
    organizations: t("organization"),
    menus: t("menu"),
    departments: t("department"),
    sessions: t("session"),
  }
  const states = {
    pending: t("pending"),
    queued: t("queued"),
    running: t("running"),
    completed: t("completed"),
    failed: t("failed"),
    rejected: t("rejected"),
  }
  const cols = columns.columns([
    columns.accessor("kind", {
      header: t("type"),
      cell: ({ row }) =>
        row.original.kind === "employee-import"
          ? t("employeeImport")
          : t("exportTask", {
              resource: resources[row.original.resource],
            }),
      size: 260,
      meta: { label: t("type") },
    }),
    columns.accessor("status", {
      header: t("status"),
      cell: ({ getValue }) => (
        <Badge variant="secondary">{states[getValue()]}</Badge>
      ),
      size: 120,
      meta: { label: t("status") },
    }),
    columns.accessor("createdAt", {
      header: t("createdAt"),
      cell: ({ getValue }) =>
        createFormatter(locale).dateTime(new Date(getValue()), "UTC"),
      size: 190,
      meta: { label: t("createdAt") },
    }),
    columns.display({
      id: "actions",
      header: t("details"),
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSearchChange({ ...search, taskId: row.original.id })}
        >
          {t("viewTask")}
        </Button>
      ),
      enableHiding: false,
    }),
  ])
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  return (
    <AdminPage
      title={t("title")}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      }
    >
      <DataTable
        columns={cols}
        data={query.data?.items ?? []}
        rowCount={query.data?.total ?? 0}
        getRowId={(item) => item.id}
        status={getDataTableQueryStatus(query)}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        empty={<p>{t("noTasks")}</p>}
        manualPagination
        enableSorting={false}
        enableRowSelection={false}
        showSearch={false}
        state={{ pagination }}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          onSearchChange({
            page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
            pageSize: next.pageSize,
          })
        }}
      />
      {search.taskId && (
        <PlatformTaskDetails
          taskId={search.taskId}
          onClose={() => onSearchChange({ ...search, taskId: undefined })}
        />
      )}
    </AdminPage>
  )
}
export function PlatformTaskDetails({
  taskId,
  onClose,
}: {
  taskId: string
  onClose: () => void
}) {
  const { t } = useTranslation(["platformTasks", "common"])
  const user = useAuthenticatedSession()!.user
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const messages = usePlatformTaskMessages()
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const downloadController = useRef<AbortController | null>(null)
  useEffect(() => () => downloadController.current?.abort(), [])
  const query = useQuery({
    queryKey: [...platformTaskKeys.scope(user.id), "detail", taskId],
    queryFn: async ({ signal }) =>
      PlatformTaskSchema.parse(
        (await getPlatformTask(taskId, { signal })).data
      ),
    retry: false,
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data && active(query.state.data.status)
          ? 1500
          : false,
  })
  const rejectAccess = usePlatformAccessFailure(query.error)
  const item = query.data
  const states = {
    pending: t("pending"),
    queued: t("queued"),
    running: t("running"),
    completed: t("completed"),
    failed: t("failed"),
    rejected: t("rejected"),
  }
  const result = item?.result
  const issueColumns = createDataTableColumnHelper<{
    rowNumber: number
    code: string
  }>()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("details")}</DialogTitle>
          <DialogDescription className="break-all">{taskId}</DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          item && (
            <div className="space-y-4">
              <Badge variant="secondary">{states[item.status]}</Badge>
              {item.errorCode && (
                <p
                  role="alert"
                  className="text-sm break-words text-destructive"
                >
                  <span>{messages[item.errorCode]}</span>
                  <code className="ms-2 text-xs">{item.errorCode}</code>
                </p>
              )}
              {result && (
                <>
                  <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-3">
                    {(
                      [
                        ["total", result.total],
                        ["created", result.created],
                        ["updated", result.updated],
                        ["granted", result.granted],
                        ["skipped", result.skipped],
                        ["failed", result.failed],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground">{t(label)}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {result.issues.length > 0 && (
                    <section className="space-y-2">
                      <h2 className="text-sm font-semibold">{t("report")}</h2>
                      <DataTable
                        columns={issueColumns.columns([
                          issueColumns.accessor("rowNumber", {
                            header: t("row"),
                            size: 80,
                          }),
                          issueColumns.accessor("code", {
                            header: t("message"),
                            cell: ({ getValue }) => (
                              <span className="break-words whitespace-normal">
                                <span>{messages[getValue()]}</span>
                                <code className="ms-2 text-xs">
                                  {getValue()}
                                </code>
                              </span>
                            ),
                            size: 380,
                          }),
                        ])}
                        data={result.issues}
                        getRowId={(issue) => `${issue.rowNumber}:${issue.code}`}
                        showSearch={false}
                        enableSorting={false}
                        enableRowSelection={false}
                      />
                    </section>
                  )}
                </>
              )}
              {item.resultAvailable &&
                platformAccess.permissions.includes(
                  "platform.task:download"
                ) && (
                  <Button
                    size="sm"
                    disabled={downloading}
                    onClick={() => {
                      setDownloadError(null)
                      setDownloading(true)
                      const controller = new AbortController()
                      downloadController.current = controller
                      void getPlatformTaskResult(taskId, {
                        signal: controller.signal,
                      })
                        .then((reply) => {
                          controller.signal.throwIfAborted()
                          savePlatformDownload(
                            reply.data,
                            `platform-task-${taskId}.xlsx`
                          )
                        })
                        .catch((error: unknown) => {
                          if (controller.signal.aborted) return
                          void rejectAccess(error)
                          setDownloadError(
                            error instanceof Error
                              ? error.message
                              : t("common:operationFailed")
                          )
                        })
                        .finally(() => {
                          if (!controller.signal.aborted) setDownloading(false)
                        })
                    }}
                  >
                    {t("download")}
                  </Button>
                )}
              {downloadError && (
                <p role="alert" className="text-sm text-destructive">
                  {downloadError}
                </p>
              )}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
