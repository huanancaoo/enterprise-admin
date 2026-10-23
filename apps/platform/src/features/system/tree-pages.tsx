import { AdminPage } from "@workspace/admin"
import { useCallback, useId, useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  listPlatformDepartments,
  createPlatformDepartment,
  updatePlatformDepartment,
  deletePlatformDepartment,
} from "@workspace/api-client"
import {
  CreatePlatformDepartmentSchema,
  PlatformDepartmentsTreeSchema,
  PlatformSystemTreeQuerySchema,
  type PlatformDepartment,
  type CreatePlatformDepartment,
} from "@workspace/contracts/platform-system"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { PlatformExportButton } from "../tasks/task-actions"
import {
  CatalogDeleteDialog,
  CatalogStatus,
  CatalogStatusField,
  CatalogSortField,
} from "./catalog-components"

type TreeRow = PlatformDepartment
const treeColumns = createDataTableColumnHelper<TreeRow>()
const EMPTY_ROWS: TreeRow[] = []
async function readTree(
  search: { parentId?: string; q?: string; status?: "active" | "disabled" },
  signal?: AbortSignal
) {
  return PlatformDepartmentsTreeSchema.parse(
    (await listPlatformDepartments(search, { signal })).data
  )
}

export function PlatformDepartmentsPage() {
  const { t } = useTranslation(["catalogs", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const search = PlatformSystemTreeQuerySchema.parse(
    useSearch({ strict: false })
  )
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<TreeRow | "new" | null>(null)
  const [deleting, setDeleting] = useState<TreeRow | null>(null)
  const statuses = useMemo(
    () => [
      { value: "active", label: t("catalogs:active") },
      { value: "disabled", label: t("catalogs:disabled") },
    ],
    [t]
  )
  const can = useCallback(
    (action: string) =>
      platformAccess.permissions.includes(`platform.department:${action}`),
    [platformAccess.permissions]
  )
  const queryKey = [
    "platform",
    session.user.id,
    "system",
    "department",
  ] as const
  const query = useQuery({
    queryKey: [...queryKey, search],
    queryFn: ({ signal }) => readTree(search, signal),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const changeSearch = useCallback(
    (patch: Record<string, unknown>) => {
      const next = PlatformSystemTreeQuerySchema.parse({ ...search, ...patch })
      void navigate({ to: "/platform/departments", search: next })
    },
    [navigate, search]
  )
  const enter = useCallback(
    (parentId?: string) =>
      changeSearch({ parentId, q: undefined, status: undefined }),
    [changeSearch]
  )
  const columns = useMemo(
    () =>
      treeColumns.columns([
        treeColumns.accessor("name", {
          header: t("catalogs:name"),
          cell: ({ row, getValue }) => (
            <Button
              variant="link"
              className="h-auto p-0 font-medium"
              onClick={() => enter(row.original.id)}
            >
              {getValue()}
            </Button>
          ),
          meta: { label: t("catalogs:name") },
          size: 230,
        }),
        treeColumns.accessor("key", {
          header: t("catalogs:key"),
          cell: ({ getValue }) => (
            <bdi className="font-mono text-xs">{getValue()}</bdi>
          ),
          meta: { label: t("catalogs:key") },
          size: 220,
        }),
        treeColumns.accessor("status", {
          header: t("catalogs:status"),
          cell: ({ getValue }) => (
            <CatalogStatus value={getValue()} statuses={statuses} />
          ),
          meta: {
            label: t("catalogs:status"),
            facetMode: "single",
            facetOptions: statuses,
          },
        }),
        treeColumns.accessor("sort", {
          header: t("catalogs:sort"),
          meta: { label: t("catalogs:sort") },
          size: 90,
        }),
        treeColumns.display({
          id: "actions",
          header: t("catalogs:actions"),
          enableHiding: false,
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => enter(row.original.id)}
              >
                {t("catalogs:children")}
              </Button>
              {can("update") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(row.original)}
                >
                  {t("catalogs:edit")}
                </Button>
              )}
              {can("delete") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleting(row.original)}
                >
                  {t("catalogs:delete")}
                </Button>
              )}
            </div>
          ),
          meta: { label: t("catalogs:actions") },
          size: 240,
        }),
      ]),
    [can, enter, statuses, t]
  )
  const filters = search.status ? [{ id: "status", value: search.status }] : []
  const tableStatus = getDataTableQueryStatus(query)
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }
  const save = async (value: CreatePlatformDepartment) => {
    const row = editing === "new" ? null : editing
    if (row) await updatePlatformDepartment(row.id, value)
    else await createPlatformDepartment(value)
    await invalidate()
  }
  return (
    <AdminPage
      actions={
        tableStatus !== "forbidden" &&
        can("create") && (
          <Button onClick={() => setEditing("new")}>
            {t("catalogs:create")}
          </Button>
        )
      }
      title={t("catalogs:departmentTitle")}
      description={t("catalogs:departmentDescription")}
    >
      <nav
        aria-label={t("catalogs:parentPath")}
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        <Button size="sm" variant="ghost" onClick={() => enter()}>
          {t("catalogs:root")}
        </Button>
        {query.data?.ancestors.map((node) => (
          <span key={node.id} className="flex items-center gap-1">
            <span aria-hidden> / </span>
            <Button size="sm" variant="ghost" onClick={() => enter(node.id)}>
              {node.name}
            </Button>
          </span>
        ))}
      </nav>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_ROWS}
        getRowId={(row) => row.id}
        rowCount={query.data?.items.length ?? 0}
        status={tableStatus}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        showPagination={false}
        searchPlaceholder={t("catalogs:search")}
        searchMaxLength={200}
        toolbarActions={
          <>
            {can("export") && (
              <PlatformExportButton resource="department" filters={search} />
            )}
          </>
        }
        state={{
          pagination: {
            pageIndex: 0,
            pageSize: Math.max(1, query.data?.items.length ?? 1),
          },
          globalFilter: search.q ?? "",
          columnFilters: filters,
        }}
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          changeSearch({ q: q || undefined })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(filters) : updater
          changeSearch({
            status: next.find((filter) => filter.id === "status")?.value,
          })
        }}
        onResetFilters={() => changeSearch({ q: undefined, status: undefined })}
      />
      {editing !== null && (
        <TreeEditorDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? undefined : editing}
          parentId={search.parentId ?? null}
          parentName={query.data?.ancestors.at(-1)?.name ?? t("catalogs:root")}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting !== null && (
        <CatalogDeleteDialog
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await deletePlatformDepartment(deleting.id)
            await invalidate()
          }}
        />
      )}
    </AdminPage>
  )
}

function TreeParentPicker({
  value,
  initialName,
  excludeId,
  disabled,
  id,
  invalid,
  onBlur,
  onChange,
}: {
  value: string | null
  initialName: string
  excludeId?: string
  disabled: boolean
  id: string
  invalid: boolean
  onBlur: () => void
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation("catalogs")
  const session = useAuthenticatedSession()!
  const [open, setOpen] = useState(false)
  const [parentId, setParentId] = useState<string>()
  const [name, setName] = useState(initialName)
  const query = useQuery({
    queryKey: [
      "platform",
      session.user.id,
      "system",
      "parent-picker",
      parentId,
    ],
    queryFn: ({ signal }) => readTree({ parentId }, signal),
    enabled: open,
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const select = (next: string | null, label: string) => {
    onChange(next)
    setName(label)
    setOpen(false)
  }
  return (
    <>
      <Button
        id={id}
        variant="outline"
        className="justify-start"
        disabled={disabled}
        onBlur={onBlur}
        aria-invalid={invalid}
        onClick={() => setOpen(true)}
      >
        {value === null ? t("root") : name}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chooseParent")}</DialogTitle>
            <DialogDescription>{t("parentHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <nav aria-label={t("parentPath")} className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setParentId(undefined)}
              >
                {t("root")}
              </Button>
              {query.data?.ancestors.map((node) => (
                <Button
                  key={node.id}
                  size="sm"
                  variant="ghost"
                  onClick={() => setParentId(node.id)}
                >
                  {node.name}
                </Button>
              ))}
            </nav>
            <Button
              size="sm"
              variant="outline"
              disabled={
                query.isPending || query.isError || parentId === excludeId
              }
              onClick={() =>
                select(
                  parentId ?? null,
                  query.data?.ancestors.at(-1)?.name ?? t("root")
                )
              }
            >
              {t("selectCurrentParent")}
            </Button>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {query.data?.items
                .filter((node) => node.id !== excludeId)
                .map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2"
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setParentId(node.id)}
                    >
                      {node.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => select(node.id, node.name)}
                    >
                      {t("select")}
                    </Button>
                  </div>
                ))}
            </div>
            {query.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("loading")}
              </p>
            )}
            {query.isError && (
              <p role="alert" className="text-sm text-destructive">
                {query.error instanceof Error
                  ? query.error.message
                  : t("loadFailed")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TreeEditorDialog({
  row,
  parentId,
  parentName,
  onClose,
  onSave,
}: {
  row?: TreeRow
  parentId: string | null
  parentName: string
  onClose: () => void
  onSave: (value: CreatePlatformDepartment) => Promise<void>
}) {
  const { t } = useTranslation(["catalogs", "common"])
  const id = useId()
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const initial: CreatePlatformDepartment = {
    key: row?.key ?? "",
    name: row?.name ?? "",
    status: row?.status ?? "active",
    sort: row?.sort ?? 0,
    parentId: row?.parentId ?? parentId,
  }
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: CreatePlatformDepartmentSchema },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        await onSave(CreatePlatformDepartmentSchema.parse(value))
        onClose()
      } catch (failure) {
        setError(failure)
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto"
            showCloseButton={!pending}
          >
            <DialogHeader>
              <DialogTitle>
                {row ? t("catalogs:edit") : t("catalogs:create")}
              </DialogTitle>
              <DialogDescription>
                {t("catalogs:treeEditHint")}
              </DialogDescription>
            </DialogHeader>
            <form
              noValidate
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={pending} className="space-y-5">
                <FieldGroup className="gap-4">
                  <form.Field name="parentId">
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field data-invalid={invalid}>
                          <FieldLabel htmlFor={`${id}-parent`}>
                            {t("catalogs:parent")}
                          </FieldLabel>
                          <TreeParentPicker
                            value={field.state.value}
                            initialName={parentName}
                            excludeId={row?.id}
                            disabled={pending}
                            id={`${id}-parent`}
                            invalid={invalid}
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                          />
                          {invalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                  {(["key", "name"] as const).map((name) => (
                    <form.Field key={name} name={name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-${name}`}>
                              {t(`catalogs:${name}`)}
                            </FieldLabel>
                            <Input
                              id={`${id}-${name}`}
                              value={field.state.value}
                              required
                              maxLength={name === "key" ? 120 : 200}
                              autoComplete="off"
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              aria-invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))}
                  <div className="grid grid-cols-2 gap-4">
                    <form.Field name="status">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <CatalogStatusField<"active" | "disabled">
                            id={`${id}-status`}
                            value={field.state.value}
                            statuses={[
                              { value: "active", label: t("catalogs:active") },
                              {
                                value: "disabled",
                                label: t("catalogs:disabled"),
                              },
                            ]}
                            onChange={field.handleChange}
                            onBlur={field.handleBlur}
                            invalid={invalid}
                            errors={field.state.meta.errors}
                          />
                        )
                      }}
                    </form.Field>
                    <form.Field name="sort">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <CatalogSortField
                            id={`${id}-sort`}
                            value={field.state.value}
                            onChange={field.handleChange}
                            onBlur={field.handleBlur}
                            invalid={invalid}
                            errors={field.state.meta.errors}
                          />
                        )
                      }}
                    </form.Field>
                  </div>
                </FieldGroup>
                {error !== undefined && (
                  <p role="alert" className="text-sm text-destructive">
                    {error instanceof Error
                      ? error.message
                      : t("common:operationFailed")}
                  </p>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={onClose}>
                    {t("common:cancel")}
                  </Button>
                  <Button type="submit">
                    {pending ? t("common:submitting") : t("common:save")}
                  </Button>
                </DialogFooter>
              </fieldset>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </form.Subscribe>
  )
}
