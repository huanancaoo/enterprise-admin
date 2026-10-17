import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, listPlatformLoginEvents } from "@workspace/api-client"
import {
  LoginLogsPageSchema,
  type LoginLog,
  type LoginLogsQuery,
} from "@workspace/contracts/identity-management"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { UserCombobox } from "../../components/user-combobox"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"

const loginColumns = createDataTableColumnHelper<LoginLog>()
const EMPTY_LOGS: LoginLog[] = []

export function PlatformLoginEventsPage() {
  const { t } = useTranslation(["identity", "common"])
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/platform/login-events" })
  const navigate = useNavigate({ from: "/platform/login-events" })
  const locale = useUiLocale()
  const query = useQuery({
    queryKey: ["platform", session.user.id, "login-events", search],
    queryFn: async ({ signal }) =>
      LoginLogsPageSchema.parse(
        (await listPlatformLoginEvents({ params: search, signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const methodLabel = (method: LoginLog["method"]) =>
    String(t(`identity:${method}Method`))
  const reasonLabel = (reason: LoginLog["reasonCode"]) => {
    if (!reason) return "—"
    const labels = {
      INVALID_CREDENTIALS: "reasonInvalidCredentials",
      EMAIL_NOT_VERIFIED: "reasonEmailNotVerified",
      INVALID_OTP: "reasonInvalidOtp",
      ACCOUNT_SUSPENDED: "reasonAccountSuspended",
      AUTHORIZATION_UNAVAILABLE: "reasonAuthorizationUnavailable",
      AUTHENTICATION_FAILED: "reasonAuthenticationFailed",
    } as const
    return String(t(`identity:${labels[reason]}`))
  }
  const columns = useMemo(() => {
    const format = createFormatter(locale)
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
      loginColumns.accessor("name", {
        header: t("user"),
        cell: ({ row, getValue }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">
              {getValue() ?? t("platformAccount")}
            </p>
            <bdi className="text-xs text-muted-foreground">
              {row.original.maskedEmail ?? row.original.userId ?? "—"}
            </bdi>
          </div>
        ),
        meta: { label: t("user") },
        size: 240,
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
        cell: ({ getValue }) => reasonLabel(getValue()),
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
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const filters = [
    ...(search.method ? [{ id: "method", value: search.method }] : []),
    ...(search.result ? [{ id: "result", value: search.result }] : []),
    ...(search.userId ? [{ id: "userId", value: search.userId }] : []),
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
          {t("loginEvents")}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {t("loginEventsDescription")}
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
        enableSorting={false}
        enableRowSelection={false}
        searchPlaceholder={t("searchLoginEvents")}
        searchMaxLength={200}
        state={{
          pagination,
          globalFilter: search.q ?? "",
          columnFilters: filters,
        }}
        toolbarContent={
          <div className="flex flex-wrap items-center gap-2">
            <UserCombobox
              value={search.userId ?? null}
              placeholder={t("filterUser")}
              onValueChange={(userId) =>
                void navigate({
                  search: { ...search, userId: userId ?? undefined, page: 1 },
                })
              }
            />
            <label className="sr-only" htmlFor="platform-login-from">
              {t("filterFrom")}
            </label>
            <Input
              id="platform-login-from"
              className="w-40"
              type="datetime-local"
              value={
                search.from
                  ? new Date(search.from).toISOString().slice(0, 16)
                  : ""
              }
              aria-label={t("filterFrom")}
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
            <label className="sr-only" htmlFor="platform-login-to">
              {t("filterTo")}
            </label>
            <Input
              id="platform-login-to"
              className="w-40"
              type="datetime-local"
              value={
                search.to ? new Date(search.to).toISOString().slice(0, 16) : ""
              }
              aria-label={t("filterTo")}
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
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, q: q || undefined, page: 1 } })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(filters) : updater
          const method = next.find((filter) => filter.id === "method")?.value
          const result = next.find((filter) => filter.id === "result")?.value
          void navigate({
            search: {
              ...search,
              method: method as LoginLogsQuery["method"],
              result: result as LoginLogsQuery["result"],
              page: 1,
            },
          })
        }}
        onResetFilters={() =>
          void navigate({ search: { page: 1, pageSize: search.pageSize } })
        }
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          void navigate({
            search: {
              ...search,
              page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            },
          })
        }}
      />
    </section>
  )
}
