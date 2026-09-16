import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { getProjectsListOptions, ApiClientError } from "@workspace/api-client"
import type { ProjectResponse, ProjectListQuery } from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { organizations } from "@workspace/mocks"
import {
  AppShell,
  LocaleSwitcher,
  TenantSwitcher,
  ResourceList,
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  PermissionGate,
  FilterBar,
  FormDialog,
} from "@workspace/admin"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"

const columnsHelper = createDataTableColumnHelper<ProjectResponse>()
const filtersSchema = z.object({
  name: z.string(),
  status: z.enum(["all", "draft", "active", "archived"]),
})
const statusBadgeVariant = {
  draft: "secondary",
  active: "default",
  archived: "outline",
} as const
// 名称按键即查，短延迟合并连续输入；状态是闭合枚举，变更立即生效。
const NAME_FILTER_DELAY_MS = 300

// Storybook 的查询参数由这个示例持有；正式列表在 S7 由 Router 接管同一份已应用条件。
export function ProjectsExample({ canCreate = true }: { canCreate?: boolean }) {
  const { t } = useTranslation(["projects", "common"])
  const locale = useUiLocale()
  const [organizationId, setOrganizationId] = useState<string>(
    organizations[0].id
  )
  const [params, setParams] = useState<ProjectListQuery>({
    page: 1,
    pageSize: 10,
    sortBy: "createdAt",
    sortOrder: "desc",
  })
  const query = useQuery(getProjectsListOptions(organizationId, params, locale))
  const nameFilterTimer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(nameFilterTimer.current), [])
  function commitFilters(value: z.infer<typeof filtersSchema>) {
    window.clearTimeout(nameFilterTimer.current)
    setParams((current) => ({
      ...current,
      page: 1,
      name: value.name.trim(),
      status: value.status === "all" ? undefined : value.status,
    }))
  }
  const form = useForm({
    defaultValues: { name: "", status: "all" } as z.infer<typeof filtersSchema>,
    validators: { onSubmit: filtersSchema },
    onSubmit: ({ value }) => commitFilters(value),
  })
  const columns = useMemo(
    () =>
      columnsHelper.columns([
        columnsHelper.accessor("name", {
          header: t("projects:name"),
          meta: { label: t("projects:name") },
          size: 320,
          enableSorting: false,
        }),
        columnsHelper.accessor("status", {
          header: t("projects:status"),
          cell: (cell) => {
            const status = cell.getValue()
            return (
              <Badge variant={statusBadgeVariant[status]}>
                {t(`projects:${status}`)}
              </Badge>
            )
          },
          meta: { label: t("projects:status") },
          enableSorting: false,
        }),
        columnsHelper.accessor("createdAt", {
          header: ({ header }) => (
            <DataTableColumnHeader
              header={header}
              title={t("projects:createdAt")}
            />
          ),
          cell: (cell) =>
            createFormatter(locale).dateTime(new Date(cell.getValue()), "UTC"),
          meta: { label: t("projects:createdAt") },
        }),
      ]),
    [locale, t]
  )
  const page = query.data?.data
  const hasFilters = Boolean(params.name) || params.status !== undefined
  const listStatus = query.isPending
    ? "loading"
    : query.isError
      ? query.error instanceof ApiClientError &&
        query.error.body.code === "FORBIDDEN"
        ? "denied"
        : "error"
      : "ready"
  const table = (
    <DataTable
      columns={columns}
      data={page?.items ?? []}
      rowCount={page?.total ?? 0}
      isLoading={query.isPending}
      manualPagination
      manualFiltering
      manualSorting
      state={{
        pagination: {
          pageIndex: params.page - 1,
          pageSize: params.pageSize,
        },
        sorting: [{ id: params.sortBy, desc: params.sortOrder === "desc" }],
      }}
      onPaginationChange={(updater) =>
        setParams((current) => {
          const previous = {
            pageIndex: current.page - 1,
            pageSize: current.pageSize,
          }
          const next =
            typeof updater === "function" ? updater(previous) : updater
          return {
            ...current,
            page: next.pageSize === current.pageSize ? next.pageIndex + 1 : 1,
            pageSize: next.pageSize,
          }
        })
      }
      onSortingChange={(updater) =>
        setParams((current) => {
          const previous = [
            { id: current.sortBy, desc: current.sortOrder === "desc" },
          ]
          const next =
            typeof updater === "function" ? updater(previous) : updater
          const sort = next[0]
          // 契约只接受 createdAt | updatedAt；本表没有 updatedAt 列，非该列或清除排序时回到默认。
          if (sort?.id !== "createdAt") {
            return {
              ...current,
              page: 1,
              sortBy: "createdAt",
              sortOrder: "desc",
            }
          }
          return {
            ...current,
            page: 1,
            sortBy: "createdAt",
            sortOrder: sort.desc ? "desc" : "asc",
          }
        })
      }
      showSearch={false}
      empty={
        hasFilters ? undefined : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("projects:emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("projects:emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      }
    />
  )
  return (
    <AppShell
      title={t("projects:title")}
      navigation={
        <a
          href="#projects"
          className="block rounded-lg bg-muted p-3 font-medium wrap-anywhere"
        >
          {t("projects:title")}
        </a>
      }
      workspace={
        <TenantSwitcher
          organizations={organizations}
          organizationId={organizationId}
          onSelect={(id) => {
            setOrganizationId(id)
            setParams((current) => ({ ...current, page: 1 }))
          }}
        />
      }
      actions={<LocaleSwitcher />}
    >
      <div id="projects">
        <ResourceList
          title={t("projects:title")}
          status={listStatus}
          onRetry={() => void query.refetch()}
          actions={
            <PermissionGate allowed={canCreate}>
              <FormDialogExample />
            </PermissionGate>
          }
          filters={
            <FilterBar
              pending={query.isFetching}
              onApply={() => void form.handleSubmit()}
            >
              <form.Field name="name">
                {(field) => (
                  <Field className="w-64 max-w-full">
                    <FieldLabel
                      htmlFor="project-filter-name"
                      className="sr-only"
                    >
                      {t("projects:name")}
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                          className="size-4"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <path d="m21 21-4.3-4.3" />
                        </svg>
                      </InputGroupAddon>
                      <InputGroupInput
                        id="project-filter-name"
                        type="search"
                        autoComplete="off"
                        value={field.state.value}
                        placeholder={t("projects:searchPlaceholder")}
                        onChange={(event) => {
                          field.handleChange(event.target.value)
                          window.clearTimeout(nameFilterTimer.current)
                          nameFilterTimer.current = window.setTimeout(
                            () => void form.handleSubmit(),
                            NAME_FILTER_DELAY_MS
                          )
                        }}
                        onBlur={field.handleBlur}
                      />
                    </InputGroup>
                  </Field>
                )}
              </form.Field>
              <form.Field name="status">
                {(field) => (
                  <Field className="w-44">
                    <FieldLabel
                      htmlFor="project-filter-status"
                      className="sr-only"
                    >
                      {t("projects:status")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={{
                        all: t("projects:allStatuses"),
                        draft: t("projects:draft"),
                        active: t("projects:active"),
                        archived: t("projects:archived"),
                      }}
                      onValueChange={(value) => {
                        if (value === null) return
                        field.handleChange(value)
                        commitFilters({
                          name: form.state.values.name,
                          status: value,
                        })
                      }}
                    >
                      <SelectTrigger id="project-filter-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          {t("projects:allStatuses")}
                        </SelectItem>
                        <SelectItem value="draft">
                          {t("projects:draft")}
                        </SelectItem>
                        <SelectItem value="active">
                          {t("projects:active")}
                        </SelectItem>
                        <SelectItem value="archived">
                          {t("projects:archived")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
              {hasFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    window.clearTimeout(nameFilterTimer.current)
                    form.reset()
                    setParams((current) => ({
                      ...current,
                      page: 1,
                      name: "",
                      status: undefined,
                    }))
                  }}
                >
                  {t("common:clearFilters")}
                </Button>
              )}
            </FilterBar>
          }
        >
          {(listStatus === "loading" || listStatus === "ready") && table}
        </ResourceList>
      </div>
    </AppShell>
  )
}

function createExampleSchema(message: string) {
  return z.object({ name: z.string().trim().min(1, message) })
}

// 验证通用 FormDialog 的草稿生命周期，不调用尚未在 S7 交付的创建业务接口。
export function FormDialogExample({
  fail = false,
  initiallyOpen = false,
  busy = false,
  longTitle = false,
}: {
  fail?: boolean
  initiallyOpen?: boolean
  busy?: boolean
  longTitle?: boolean
}) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const [open, setOpen] = useState(initiallyOpen)
  const [error, setError] = useState<string>()
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: createExampleSchema(t("validation:projectName")) },
    onSubmit: async ({ formApi }) => {
      setError(undefined)
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (fail) {
        setError(t("common:operationFailed"))
        return
      }
      formApi.reset()
      setOpen(false)
    },
  })
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("projects:create")}</Button>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={open}
            onOpenChange={setOpen}
            title={
              longTitle ? t("projects:create").repeat(20) : t("projects:create")
            }
            description={t("projects:name")}
            onSubmit={() => void form.handleSubmit()}
            pending={pending || busy}
            error={error}
          >
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="example-project-name">
                        {t("projects:name")}
                      </FieldLabel>
                      <Input
                        id="example-project-name"
                        name={field.name}
                        required
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
          </FormDialog>
        )}
      </form.Subscribe>
    </>
  )
}
