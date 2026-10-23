import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  ApiClientError,
  listNotifications,
  readNotification,
  type Notification,
} from "@workspace/api-client"
import {
  NotificationPageSchema,
  type CapabilityPageQuery,
} from "@workspace/contracts/framework-capabilities"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  AdminPage,
} from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { NotificationPreferencesSettings } from "./notification-preferences"
import { useOrganizationAuthorization } from "@/hooks/use-organization-authorization"

type Props = {
  organizationId: string
  search: CapabilityPageQuery
  onSearchChange: (next: CapabilityPageQuery) => void
  onOpenTask: (taskId: string) => void
}
const columnHelper = createDataTableColumnHelper<Notification>()
export function NotificationCenter(props: Props) {
  const { t } = useTranslation("notifications")

  const user = useAuthenticatedSession()!.user
  const membership = useOrganizationAuthorization({
    organizationId: props.organizationId,
    userId: user.id,
    observation: "notifications",
  })
  if (membership.error)
    return (
      <AdminPage title={t("title")}>
        {membership.error instanceof ApiClientError &&
        [401, 403].includes(membership.error.status) ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState onRetry={() => void membership.refetch()} />
        )}
      </AdminPage>
    )
  if (membership.isPending)
    return (
      <AdminPage title={t("title")}>
        <LoadingState />
      </AdminPage>
    )
  const { authorizationVersion, scopeKey } = membership.data
  return (
    <ScopedInbox
      key={scopeKey}
      {...props}
      userId={user.id}
      authorizationVersion={authorizationVersion}
    />
  )
}
function ScopedInbox({
  organizationId,
  userId,
  authorizationVersion,
  search,
  onSearchChange,
  onOpenTask,
}: Props & { userId: string; authorizationVersion: number }) {
  const { t, i18n } = useTranslation(["notifications", "common"])
  const prefix = [
    "organizations",
    organizationId,
    "users",
    userId,
    "authorization",
    authorizationVersion,
    "notifications",
  ]
  const messages = useQuery({
    queryKey: [...prefix, search],
    retry: false,
    queryFn: async ({ signal }) =>
      NotificationPageSchema.parse(
        (await listNotifications(organizationId, search, { signal })).data
      ),
  })
  const client = useQueryClient()
  const markRead = useMutation({
    retry: false,
    mutationFn: (id: string) => readNotification(organizationId, id),
    onSuccess: () => client.invalidateQueries({ queryKey: prefix }),
  })
  const title = (notification: Notification) =>
    notification.taskType === "projects.import"
      ? notification.type === "task.completed"
        ? t("importCompleted")
        : t("importFailed")
      : notification.type === "task.completed"
        ? t("exportCompleted")
        : t("exportFailed")
  const columns = columnHelper.columns([
    columnHelper.display({
      id: "message",
      header: t("message"),
      size: 320,
      meta: { allowCellOverflow: true },
      cell: ({ row }) => (
        <button
          className="text-start font-medium whitespace-normal underline-offset-4 hover:underline"
          onClick={() => onOpenTask(row.original.taskId)}
        >
          {title(row.original)}
        </button>
      ),
    }),
    columnHelper.accessor("createdAt", {
      header: t("receivedAt"),
      cell: (cell) =>
        new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(cell.getValue())),
    }),
    columnHelper.display({
      id: "status",
      header: t("status"),
      cell: ({ row }) => (
        <Badge variant={row.original.readAt === null ? "default" : "secondary"}>
          {row.original.readAt === null ? t("unread") : t("read")}
        </Badge>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: t("actions"),
      size: 240,
      meta: { allowCellOverflow: true },
      cell: ({ row }) =>
        row.original.readAt === null ? (
          <div className="space-y-2">
            <Button
              variant="outline"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(row.original.id)}
            >
              {t("markRead")}
            </Button>
            {markRead.isError && markRead.variables === row.original.id && (
              <p
                role="alert"
                className="text-sm whitespace-normal text-destructive"
              >
                {t("readError")}
              </p>
            )}
          </div>
        ) : null,
    }),
  ])
  const authorityError = messages.error ?? markRead.error
  if (
    authorityError instanceof ApiClientError &&
    [401, 403].includes(authorityError.status)
  )
    return (
      <AdminPage title={t("title")}>
        <PermissionDeniedState />
      </AdminPage>
    )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  return (
    <AdminPage title={t("title")}>
      {messages.data && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("unreadTotal", {
            total: new Intl.NumberFormat(i18n.language).format(
              messages.data.unreadCount
            ),
          })}
        </p>
      )}
      <DataTable
        columns={columns}
        data={messages.data?.items ?? []}
        getRowId={(row) => row.id}
        status={
          messages.isError
            ? "error"
            : messages.isPending
              ? "loading"
              : messages.isFetching
                ? "refreshing"
                : "ready"
        }
        error={t("loadError")}
        onRetry={() => void messages.refetch()}
        showSearch={false}
        manualPagination
        rowCount={messages.data?.total ?? 0}
        state={{ pagination }}
        onPaginationChange={(update) => {
          const next =
            typeof update === "function" ? update(pagination) : update
          onSearchChange({ page: next.pageIndex + 1, pageSize: next.pageSize })
        }}
        enableSorting={false}
        enableHiding={false}
        enableRowSelection={false}
        empty={<p className="p-6 text-muted-foreground">{t("empty")}</p>}
      />
      <NotificationPreferencesSettings organizationId={organizationId} />
    </AdminPage>
  )
}
