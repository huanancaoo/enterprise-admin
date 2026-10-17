import { useEffect, useMemo } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, listMyLoginEvents } from "@workspace/api-client"
import {
  LoginLogsPageSchema,
  PersonalLoginLogsQuerySchema,
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
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

const loginColumns = createDataTableColumnHelper<LoginLog>()
const EMPTY_LOGS: LoginLog[] = []

export function PersonalLoginEventsRoute() {
  const { t } = useTranslation(["identity", "common", "organization"])
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/app/settings/login-events" })
  const navigate = useNavigate({ from: "/app/settings/login-events" })
  const locale = useUiLocale()
  const filterQuery = (value: { from: string; to: string }) => ({
    ...search,
    from: value.from ? `${value.from}:00Z` : undefined,
    to: value.to ? `${value.to}:00Z` : undefined,
    page: 1,
  })
  const filtersForm = useForm({
    defaultValues: {
      from: search.from ? new Date(search.from).toISOString().slice(0, 16) : "",
      to: search.to ? new Date(search.to).toISOString().slice(0, 16) : "",
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = PersonalLoginLogsQuerySchema.safeParse(
          filterQuery(value)
        )
        if (result.success) return undefined
        return {
          fields: Object.fromEntries(
            result.error.issues.map((issue) => [
              issue.path[0],
              { message: t("organization:platformAuditInvalid") },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = PersonalLoginLogsQuerySchema.parse(filterQuery(value))
      await navigate({ search: parsed })
    },
  })
  // URL 条件变更时回填表单；搜索和翻页不覆盖尚未应用的筛选输入。
  useEffect(() => {
    filtersForm.reset({
      from: search.from ? new Date(search.from).toISOString().slice(0, 16) : "",
      to: search.to ? new Date(search.to).toISOString().slice(0, 16) : "",
    })
  }, [filtersForm, search.from, search.to])
  const { page, pageSize, ...filters } = search
  const query = useQuery({
    queryKey: ["identity", session.user.id, "my-login-events", search],
    queryFn: async ({ signal }) =>
      LoginLogsPageSchema.parse(
        (await listMyLoginEvents({ page, pageSize, ...filters }, { signal }))
          .data
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
            PASSWORD_LOGIN_LOCKED: "reasonPasswordLoginLocked",
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
        toolbarFilters={
          <filtersForm.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <form
                className="w-full max-w-full min-w-0 sm:w-auto"
                noValidate
                aria-busy={busy || query.isFetching}
                onSubmit={(event) => {
                  event.preventDefault()
                  void filtersForm.handleSubmit()
                }}
              >
                <fieldset
                  disabled={busy || query.isFetching}
                  className="flex min-w-0 flex-wrap items-end gap-2"
                >
                  <FieldGroup className="contents">
                    {(["from", "to"] as const).map((name) => (
                      <filtersForm.Field key={name} name={name}>
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          const label =
                            name === "from" ? t("filterFrom") : t("filterTo")
                          const id = `personal-login-${name}`
                          return (
                            <Field
                              data-invalid={invalid}
                              className="w-full gap-1 sm:w-56"
                            >
                              <FieldLabel
                                className="text-xs text-muted-foreground"
                                htmlFor={id}
                              >
                                {label}
                              </FieldLabel>
                              <Input
                                id={id}
                                type="datetime-local"
                                value={field.state.value}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                onBlur={field.handleBlur}
                                aria-invalid={invalid}
                                aria-describedby={
                                  invalid ? `${id}-error` : undefined
                                }
                              />
                              {invalid && (
                                <FieldError
                                  id={`${id}-error`}
                                  errors={field.state.meta.errors}
                                />
                              )}
                            </Field>
                          )
                        }}
                      </filtersForm.Field>
                    ))}
                  </FieldGroup>
                  <Button type="submit" size="sm" className="h-9">
                    {t("organization:platformApplyFilters")}
                  </Button>
                </fieldset>
              </form>
            )}
          </filtersForm.Subscribe>
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
