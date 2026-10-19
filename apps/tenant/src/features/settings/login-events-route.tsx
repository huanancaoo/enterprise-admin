import { useEffect, useMemo } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { listMyLoginEvents } from "@workspace/api-client"
import {
  LoginLogsPageSchema,
  PersonalLoginLogsQuerySchema,
  type LoginLog,
  type PersonalLoginLogsQuery,
} from "@workspace/contracts/identity-management"
import {
  useAuthenticatedSession,
  useLoginEventColumns,
  utcDateTimeFilterValues,
  utcDateTimeFilterQuery,
  LoginEventTimeFilterField,
} from "@workspace/admin/auth"
import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { FieldGroup } from "@workspace/ui/components/field"

const loginColumns = createDataTableColumnHelper<LoginLog>()
const EMPTY_LOGS: LoginLog[] = []

export function PersonalLoginEventsRoute() {
  const { t } = useTranslation(["identity", "common", "organization"])
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/app/settings/login-events" })
  const navigate = useNavigate({ from: "/app/settings/login-events" })
  const commonColumns = useLoginEventColumns<LoginLog>()
  const filterQuery = (value: { from: string; to: string }) => ({
    ...search,
    ...utcDateTimeFilterQuery(value),
    page: 1,
  })
  const filtersForm = useForm({
    defaultValues: {
      ...utcDateTimeFilterValues(search),
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
      ...utcDateTimeFilterValues({ from: search.from, to: search.to }),
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
  const columns = useMemo(
    () =>
      loginColumns.columns([
        commonColumns.occurredAt,
        commonColumns.method,
        commonColumns.result,
        commonColumns.reasonCode,
        commonColumns.ipAddress,
        commonColumns.userAgent,
      ]),
    [commonColumns]
  )
  const pagination = { pageIndex: page - 1, pageSize }
  const columnFilters = [
    ...(search.method ? [{ id: "method", value: search.method }] : []),
    ...(search.result ? [{ id: "result", value: search.result }] : []),
    ...(search.from || search.to
      ? [{ id: "occurredAt", value: { from: search.from, to: search.to } }]
      : []),
  ]
  const status = getDataTableQueryStatus(query)
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
                          return (
                            <LoginEventTimeFilterField
                              id={`personal-login-${name}`}
                              label={
                                name === "from"
                                  ? t("filterFrom")
                                  : t("filterTo")
                              }
                              value={field.state.value}
                              onChange={field.handleChange}
                              onBlur={field.handleBlur}
                              invalid={invalid}
                              errors={field.state.meta.errors}
                            />
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
