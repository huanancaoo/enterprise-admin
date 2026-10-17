import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, listMyLoginEvents } from "@workspace/api-client"
import {
  LoginLogsPageSchema,
  type LoginLog,
  type PersonalLoginLogsQuery,
} from "@workspace/contracts/identity-management"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"

const loginColumns = createDataTableColumnHelper<LoginLog>()
const EMPTY_LOGS: LoginLog[] = []

export function PersonalLoginEventsRoute() {
  const { t } = useTranslation(["identity", "common"])
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/app/settings/login-events" })
  const navigate = useNavigate({ from: "/app/settings/login-events" })
  const locale = useUiLocale()
  const { page, pageSize, ...filters } = search
  const query = useQuery({
    queryKey: ["identity", session.user.id, "my-login-events", search],
    queryFn: async ({ signal }) =>
      LoginLogsPageSchema.parse(
        (
          await listMyLoginEvents({
            params: { page, pageSize, ...filters },
            signal,
          })
        ).data
      ),
    retry: false,
  })
  const columns = useMemo(() => {
    const format = createFormatter(locale)
    const methodLabel = (method: LoginLog["method"]) =>
      String(t(`identity:${method}Method`))
    return loginColumns.columns([
      loginColumns.accessor("occurredAt", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("occurredAt")} />
        ),
        cell: ({ getValue }) =>
          format.dateTime(new Date(getValue()), "UTC", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        meta: { label: t("occurredAt") },
        size: 210,
      }),
      loginColumns.accessor("method", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("method")} />
        ),
        cell: ({ getValue }) => methodLabel(getValue()),
        meta: {
          label: t("method"),
          facetMode: "single",
          facetOptions: (["email", "github", "totp"] as const).map((value) => ({
            value,
            label: methodLabel(value),
          })),
        },
      }),
      loginColumns.accessor("result", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("result")} />
        ),
        cell: ({ getValue }) => (
          <Badge variant={getValue() === "succeeded" ? "secondary" : "outline"}>
            {t(getValue())}
          </Badge>
        ),
        meta: {
          label: t("result"),
          facetMode: "single",
          facetOptions: (["succeeded", "failed"] as const).map((value) => ({
            value,
            label: String(t(value)),
          })),
        },
      }),
      loginColumns.accessor("reasonCode", {
        header: t("reason"),
        cell: ({ getValue }) => {
          const reason = getValue()
          if (!reason) return "—"
          const labels = {
            INVALID_CREDENTIALS: "reasonInvalidCredentials",
            EMAIL_NOT_VERIFIED: "reasonEmailNotVerified",
            INVALID_OTP: "reasonInvalidOtp",
            ACCOUNT_SUSPENDED: "reasonAccountSuspended",
            AUTHORIZATION_UNAVAILABLE: "reasonAuthorizationUnavailable",
            AUTHENTICATION_FAILED: "reasonAuthenticationFailed",
          } as const
          return t(`identity:${labels[reason]}`)
        },
        meta: { label: t("reason") },
      }),
      loginColumns.accessor("ipAddress", {
        header: t("ipAddress"),
        cell: ({ getValue }) => (
          <bdi className="font-mono text-xs">{getValue() ?? "—"}</bdi>
        ),
        meta: { label: t("ipAddress") },
        size: 160,
      }),
      loginColumns.accessor("userAgent", {
        header: t("userAgent"),
        cell: ({ getValue }) => (
          <span className="line-clamp-2">{getValue() ?? "—"}</span>
        ),
        meta: { label: t("userAgent") },
        size: 300,
      }),
    ])
  }, [locale, t])
  const pagination = { pageIndex: page - 1, pageSize }
  const columnFilters = [
    ...(search.method ? [{ id: "method", value: search.method }] : []),
    ...(search.result ? [{ id: "result", value: search.result }] : []),
    ...(search.from || search.to
      ? [{ id: "occurredAt", value: { from: search.from, to: search.to } }]
      : []),
  ]
  const status: DataTableStatus = query.isError
    ? query.error instanceof ApiClientError && query.error.status === 403
      ? "forbidden"
      : "error"
    : query.isPending
      ? "loading"
      : query.isFetching
        ? "refreshing"
        : "ready"
  return (
    <section className="min-w-0 space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("personalLoginEvents")}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {t("personalLoginEventsDescription")}
        </p>
      </header>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_LOGS}
        empty={
          <p className="text-sm text-muted-foreground">{t("noLoginEvents")}</p>
        }
        getRowId={(row) => row.id}
        rowCount={query.data?.total ?? 0}
        status={status}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        showSearch={false}
        enableSorting={false}
        enableRowSelection={false}
        state={{ pagination, columnFilters }}
        toolbarContent={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              type="datetime-local"
              aria-label={t("filterFrom")}
              value={
                search.from
                  ? new Date(search.from).toISOString().slice(0, 16)
                  : ""
              }
              onChange={(event) =>
                void navigate({
                  search: {
                    ...search,
                    from: event.target.value
                      ? `${event.target.value}:00Z`
                      : undefined,
                    page: 1,
                  },
                })
              }
            />
            <Input
              className="w-40"
              type="datetime-local"
              aria-label={t("filterTo")}
              value={
                search.to ? new Date(search.to).toISOString().slice(0, 16) : ""
              }
              onChange={(event) =>
                void navigate({
                  search: {
                    ...search,
                    to: event.target.value
                      ? `${event.target.value}:00Z`
                      : undefined,
                    page: 1,
                  },
                })
              }
            />
          </div>
        }
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const method = next.find((filter) => filter.id === "method")?.value
          const result = next.find((filter) => filter.id === "result")?.value
          void navigate({
            search: {
              ...search,
              method: method as PersonalLoginLogsQuery["method"],
              result: result as PersonalLoginLogsQuery["result"],
              page: 1,
            },
          })
        }}
        onResetFilters={() => void navigate({ search: { page: 1, pageSize } })}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          void navigate({
            search: {
              ...search,
              page: next.pageSize === pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            },
          })
        }}
      />
    </section>
  )
}
