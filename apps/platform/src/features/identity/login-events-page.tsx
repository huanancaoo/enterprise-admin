import { useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, listPlatformLoginEvents } from "@workspace/api-client"
import {
  LoginLogsPageSchema,
  LoginLogsQuerySchema,
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
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { FilterIcon } from "lucide-react"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"

const loginColumns = createDataTableColumnHelper<LoginLog>()
const EMPTY_LOGS: LoginLog[] = []

export function PlatformLoginEventsPage() {
  const { t } = useTranslation(["identity", "common", "organization"])
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/platform/login-events" })
  const navigate = useNavigate({ from: "/platform/login-events" })
  const locale = useUiLocale()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterQuery = (value: {
    userId: string
    from: string
    to: string
  }) => ({
    ...search,
    userId: value.userId || undefined,
    from: value.from ? `${value.from}:00Z` : undefined,
    to: value.to ? `${value.to}:00Z` : undefined,
    page: 1,
  })
  const filtersForm = useForm({
    defaultValues: {
      userId: search.userId ?? "",
      from: search.from ? new Date(search.from).toISOString().slice(0, 16) : "",
      to: search.to ? new Date(search.to).toISOString().slice(0, 16) : "",
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = LoginLogsQuerySchema.safeParse(filterQuery(value))
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
      const parsed = LoginLogsQuerySchema.parse(filterQuery(value))
      await navigate({ search: parsed })
      setFiltersOpen(false)
    },
  })
  const query = useQuery({
    queryKey: ["platform", session.user.id, "login-events", search],
    queryFn: async ({ signal }) =>
      LoginLogsPageSchema.parse(
        (await listPlatformLoginEvents(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const columns = useMemo(() => {
    const format = createFormatter(locale)
    const methodLabels = {
      email: String(t("emailMethod")),
      github: String(t("githubMethod")),
      totp: String(t("totpMethod")),
    } satisfies Record<LoginLog["method"], string>
    const resultLabels = {
      succeeded: String(t("succeeded")),
      failed: String(t("failed")),
    } satisfies Record<LoginLog["result"], string>
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
        cell: ({ getValue }) => methodLabels[getValue()],
        meta: {
          label: t("method"),
          facetMode: "single",
          facetOptions: (["email", "github", "totp"] as const).map((value) => ({
            value,
            label: methodLabels[value],
          })),
        },
      }),
      loginColumns.accessor("result", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("result")} />
        ),
        cell: ({ getValue }) => (
          <Badge variant={getValue() === "succeeded" ? "secondary" : "outline"}>
            {resultLabels[getValue()]}
          </Badge>
        ),
        meta: {
          label: t("result"),
          facetMode: "single",
          facetOptions: (["succeeded", "failed"] as const).map((value) => ({
            value,
            label: resultLabels[value],
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
          <Popover
            open={filtersOpen}
            onOpenChange={(open) => {
              if (open) {
                filtersForm.setFieldValue("userId", search.userId ?? "")
                filtersForm.setFieldValue(
                  "from",
                  search.from
                    ? new Date(search.from).toISOString().slice(0, 16)
                    : ""
                )
                filtersForm.setFieldValue(
                  "to",
                  search.to
                    ? new Date(search.to).toISOString().slice(0, 16)
                    : ""
                )
              }
              setFiltersOpen(open)
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetching}
                />
              }
            >
              <FilterIcon data-icon="inline-start" />
              {t("organization:platformOperationAdvancedFilters")}
              {(search.userId || search.from || search.to) && (
                <Badge variant="secondary">
                  {
                    [search.userId, search.from || search.to].filter(Boolean)
                      .length
                  }
                </Badge>
              )}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[min(40rem,calc(100dvh-4rem))] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto"
            >
              <PopoverHeader>
                <PopoverTitle>
                  {t("organization:platformOperationAdvancedFilters")}
                </PopoverTitle>
              </PopoverHeader>
              <filtersForm.Subscribe selector={(state) => state.isSubmitting}>
                {(busy) => (
                  <form
                    noValidate
                    aria-busy={busy || query.isFetching}
                    onSubmit={(event) => {
                      event.preventDefault()
                      void filtersForm.handleSubmit()
                    }}
                  >
                    <fieldset
                      disabled={busy || query.isFetching}
                      className="space-y-4"
                    >
                      <FieldGroup className="grid gap-4 sm:grid-cols-2">
                        <filtersForm.Field name="userId">
                          {(field) => {
                            const invalid =
                              field.state.meta.isTouched &&
                              !field.state.meta.isValid
                            return (
                              <Field data-invalid={invalid}>
                                <FieldLabel htmlFor="platform-login-user">
                                  {t("filterUser")}
                                </FieldLabel>
                                <UserCombobox
                                  id="platform-login-user"
                                  value={field.state.value || null}
                                  placeholder={t("filterUser")}
                                  onValueChange={(userId) =>
                                    field.handleChange(userId ?? "")
                                  }
                                  onBlur={field.handleBlur}
                                  invalid={invalid}
                                  aria-describedby={
                                    invalid
                                      ? "platform-login-user-error"
                                      : undefined
                                  }
                                />
                                {invalid && (
                                  <FieldError
                                    id="platform-login-user-error"
                                    errors={field.state.meta.errors}
                                  />
                                )}
                              </Field>
                            )
                          }}
                        </filtersForm.Field>
                        {(["from", "to"] as const).map((name) => (
                          <filtersForm.Field key={name} name={name}>
                            {(field) => {
                              const invalid =
                                field.state.meta.isTouched &&
                                !field.state.meta.isValid
                              const label =
                                name === "from"
                                  ? t("filterFrom")
                                  : t("filterTo")
                              const id = `platform-login-${name}`
                              return (
                                <Field data-invalid={invalid}>
                                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
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
                      <div className="flex justify-end gap-2 border-t pt-4">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFiltersOpen(false)}
                        >
                          {t("common:close")}
                        </Button>
                        <Button type="submit">
                          {t("organization:platformApplyFilters")}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </filtersForm.Subscribe>
            </PopoverContent>
          </Popover>
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
