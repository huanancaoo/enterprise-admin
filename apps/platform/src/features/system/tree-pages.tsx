import { useCallback, useId, useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  listPlatformMenus,
  createPlatformMenu,
  updatePlatformMenu,
  deletePlatformMenu,
  listPlatformDepartments,
  createPlatformDepartment,
  updatePlatformDepartment,
  deletePlatformDepartment,
  getPlatformMenuRegistry,
} from "@workspace/api-client"
import {
  CreatePlatformMenuSchema,
  CreatePlatformDepartmentSchema,
  PlatformMenuRegistrySchema,
  PlatformMenusTreeSchema,
  PlatformDepartmentsTreeSchema,
  PlatformSystemTreeQuerySchema,
  type PlatformMenu,
  type PlatformDepartment,
  type CreatePlatformMenu,
} from "@workspace/contracts/platform-system"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { PlatformExportButton } from "../tasks/task-actions"
import {
  CatalogDeleteDialog,
  CatalogStatus,
  CatalogStatusField,
  CatalogSortField,
} from "./catalog-components"

type TreeKind = "menu" | "department"
type TreeRow = PlatformMenu | PlatformDepartment
const treeColumns = createDataTableColumnHelper<TreeRow>()
const EMPTY_ROWS: TreeRow[] = []
function menuEditorSchema(required: string) {
  return CreatePlatformMenuSchema.superRefine((value, context) => {
    const target =
      value.kind === "page"
        ? "routeKey"
        : value.kind === "action"
          ? "actionKey"
          : value.kind === "external" || value.kind === "iframe"
            ? "url"
            : null
    if (target && !value[target])
      context.addIssue({ code: "custom", path: [target], message: required })
  })
}
const kinds = ["directory", "page", "action", "external", "iframe"] as const

async function readTree(
  kind: TreeKind,
  search: { parentId?: string; q?: string; status?: "active" | "disabled" },
  signal?: AbortSignal
) {
  return kind === "menu"
    ? PlatformMenusTreeSchema.parse(
        (await listPlatformMenus(search, { signal })).data
      )
    : PlatformDepartmentsTreeSchema.parse(
        (await listPlatformDepartments(search, { signal })).data
      )
}

export function PlatformMenusPage() {
  return <PlatformTreePage kind="menu" />
}
export function PlatformDepartmentsPage() {
  return <PlatformTreePage kind="department" />
}

function PlatformTreePage({ kind }: { kind: TreeKind }) {
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
      platformAccess.permissions.includes(`platform.${kind}:${action}`),
    [kind, platformAccess.permissions]
  )
  const queryKey = ["platform", session.user.id, "system", kind] as const
  const query = useQuery({
    queryKey: [...queryKey, search],
    queryFn: ({ signal }) => readTree(kind, search, signal),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const changeSearch = useCallback(
    (patch: Record<string, unknown>) => {
      const next = PlatformSystemTreeQuerySchema.parse({ ...search, ...patch })
      if (kind === "menu")
        void navigate({ to: "/platform/menus", search: next })
      else void navigate({ to: "/platform/departments", search: next })
    },
    [kind, navigate, search]
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
        ...(kind === "menu"
          ? [
              treeColumns.accessor((row) => ("kind" in row ? row.kind : ""), {
                id: "kind",
                header: t("catalogs:kind"),
                cell: ({ getValue }) =>
                  (() => {
                    const value = getValue()
                    return value ? t(`catalogs:${value}`) : "—"
                  })(),
                meta: { label: t("catalogs:kind") },
              }),
              treeColumns.accessor(
                (row) =>
                  "kind" in row
                    ? (row.routeKey ?? row.actionKey ?? row.url)
                    : null,
                {
                  id: "target",
                  header: t("catalogs:target"),
                  cell: ({ getValue }) => (
                    <span className="line-clamp-2 text-xs break-all">
                      {getValue() ?? "—"}
                    </span>
                  ),
                  size: 260,
                  meta: { label: t("catalogs:target") },
                }
              ),
              treeColumns.accessor(
                (row) => ("hidden" in row ? row.hidden : false),
                {
                  id: "hidden",
                  header: t("catalogs:hidden"),
                  cell: ({ getValue }) =>
                    getValue() ? t("catalogs:yes") : t("catalogs:no"),
                  meta: { label: t("catalogs:hidden") },
                }
              ),
            ]
          : []),
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
    [can, enter, kind, statuses, t]
  )
  const filters = search.status ? [{ id: "status", value: search.status }] : []
  const tableStatus: DataTableStatus = query.isError
    ? query.error instanceof ApiClientError && query.error.status === 403
      ? "forbidden"
      : "error"
    : query.isPending
      ? "loading"
      : query.isFetching
        ? "refreshing"
        : "ready"
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey })
    if (kind === "menu")
      await queryClient.invalidateQueries({
        queryKey: ["platform", session.user.id, "navigation"],
      })
  }
  const save = async (value: CreatePlatformMenu) => {
    const row = editing === "new" ? null : editing
    if (kind === "menu") {
      if (row) await updatePlatformMenu(row.id, value)
      else await createPlatformMenu(value)
    } else {
      const body = CreatePlatformDepartmentSchema.parse({
        key: value.key,
        name: value.name,
        status: value.status,
        sort: value.sort,
        parentId: value.parentId,
      })
      if (row) await updatePlatformDepartment(row.id, body)
      else await createPlatformDepartment(body)
    }
    await invalidate()
  }
  return (
    <section className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {kind === "menu"
            ? t("catalogs:menuTitle")
            : t("catalogs:departmentTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {kind === "menu"
            ? t("catalogs:menuDescription")
            : t("catalogs:departmentDescription")}
        </p>
      </header>
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
        toolbarContent={
          <>
            {can("create") && (
              <Button size="sm" onClick={() => setEditing("new")}>
                {t("catalogs:create")}
              </Button>
            )}
            {can("export") && (
              <PlatformExportButton resource={kind} filters={search} />
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
          kind={kind}
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
            if (kind === "menu") await deletePlatformMenu(deleting.id)
            else await deletePlatformDepartment(deleting.id)
            await invalidate()
          }}
        />
      )}
    </section>
  )
}

function TreeParentPicker({
  kind,
  value,
  initialName,
  excludeId,
  disabled,
  id,
  invalid,
  onBlur,
  onChange,
}: {
  kind: TreeKind
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
      kind,
      "parent-picker",
      parentId,
    ],
    queryFn: ({ signal }) => readTree(kind, { parentId }, signal),
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
                .filter(
                  (node) =>
                    node.id !== excludeId &&
                    (!("kind" in node) ||
                      node.kind === "directory" ||
                      node.kind === "page")
                )
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
  kind,
  row,
  parentId,
  parentName,
  onClose,
  onSave,
}: {
  kind: TreeKind
  row?: TreeRow
  parentId: string | null
  parentName: string
  onClose: () => void
  onSave: (value: CreatePlatformMenu) => Promise<void>
}) {
  const { t } = useTranslation(["catalogs", "common"])
  const id = useId()
  const session = useAuthenticatedSession()!
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const registry = useQuery({
    queryKey: ["platform", session.user.id, "menu-registry"],
    queryFn: async ({ signal }) =>
      PlatformMenuRegistrySchema.parse(
        (await getPlatformMenuRegistry({ signal })).data
      ),
    enabled: kind === "menu",
    retry: false,
  })
  usePlatformAccessFailure(registry.error)
  const initial: CreatePlatformMenu = {
    key: row?.key ?? "",
    name: row?.name ?? "",
    status: row?.status ?? "active",
    sort: row?.sort ?? 0,
    parentId: row?.parentId ?? parentId,
    kind: row && "kind" in row ? row.kind : "directory",
    routeKey: row && "routeKey" in row ? row.routeKey : null,
    actionKey: row && "actionKey" in row ? row.actionKey : null,
    url: row && "url" in row ? row.url : null,
    icon: row && "icon" in row ? row.icon : null,
    hidden: row && "hidden" in row ? row.hidden : false,
  }
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: menuEditorSchema(t("catalogs:invalid")) },
    onSubmit: async ({ value }) => {
      setError(undefined)
      // 节点类型决定唯一目标；变更类型后清除此前类型的关联。
      const body = {
        ...value,
        routeKey: value.kind === "page" ? value.routeKey : null,
        actionKey: value.kind === "action" ? value.actionKey : null,
        url:
          value.kind === "external" || value.kind === "iframe"
            ? value.url
            : null,
      }
      try {
        await onSave(CreatePlatformMenuSchema.parse(body))
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
                            kind={kind}
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
                  {kind === "menu" && (
                    <>
                      <form.Field name="kind">
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          return (
                            <Field data-invalid={invalid}>
                              <FieldLabel htmlFor={`${id}-kind`}>
                                {t("catalogs:kind")}
                              </FieldLabel>
                              <Select
                                items={kinds.map((value) => ({
                                  value,
                                  label: t(`catalogs:${value}`),
                                }))}
                                value={field.state.value}
                                onValueChange={(value) =>
                                  value !== null && field.handleChange(value)
                                }
                              >
                                <SelectTrigger
                                  id={`${id}-kind`}
                                  className="w-full"
                                  onBlur={field.handleBlur}
                                  aria-invalid={invalid}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {kinds.map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {t(`catalogs:${value}`)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {invalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                      <form.Subscribe selector={(state) => state.values.kind}>
                        {(menuKind) => (
                          <>
                            {(menuKind === "page" || menuKind === "action") && (
                              <form.Field
                                name={
                                  menuKind === "page" ? "routeKey" : "actionKey"
                                }
                              >
                                {(field) => {
                                  const invalid =
                                    field.state.meta.isTouched &&
                                    !field.state.meta.isValid
                                  const options =
                                    menuKind === "page"
                                      ? registry.data?.pages
                                      : registry.data?.actions
                                  return (
                                    <Field data-invalid={invalid}>
                                      <FieldLabel htmlFor={`${id}-target`}>
                                        {menuKind === "page"
                                          ? t("catalogs:registeredPage")
                                          : t("catalogs:registeredAction")}
                                      </FieldLabel>
                                      <Select
                                        items={options?.map((option) => ({
                                          value: option.key,
                                          label: `${option.key}${
                                            "path" in option
                                              ? ` · ${option.path}`
                                              : ""
                                          }`,
                                        }))}
                                        value={field.state.value ?? ""}
                                        onValueChange={(value) =>
                                          field.handleChange(value || null)
                                        }
                                        disabled={
                                          registry.isPending || registry.isError
                                        }
                                      >
                                        <SelectTrigger
                                          id={`${id}-target`}
                                          className="w-full"
                                          onBlur={field.handleBlur}
                                          aria-invalid={invalid}
                                        >
                                          <SelectValue
                                            placeholder={t(
                                              "catalogs:chooseTarget"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {options?.map((option) => (
                                            <SelectItem
                                              key={option.key}
                                              value={option.key}
                                            >
                                              {option.key}
                                              {"path" in option
                                                ? ` · ${option.path}`
                                                : ""}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {invalid && (
                                        <FieldError
                                          errors={field.state.meta.errors}
                                        />
                                      )}
                                    </Field>
                                  )
                                }}
                              </form.Field>
                            )}
                            {(menuKind === "external" ||
                              menuKind === "iframe") && (
                              <form.Field name="url">
                                {(field) => {
                                  const invalid =
                                    field.state.meta.isTouched &&
                                    !field.state.meta.isValid
                                  return (
                                    <Field data-invalid={invalid}>
                                      <FieldLabel htmlFor={`${id}-url`}>
                                        {t("catalogs:url")}
                                      </FieldLabel>
                                      <Input
                                        id={`${id}-url`}
                                        type="url"
                                        required
                                        maxLength={2000}
                                        value={field.state.value ?? ""}
                                        onBlur={field.handleBlur}
                                        onChange={(event) =>
                                          field.handleChange(
                                            event.target.value || null
                                          )
                                        }
                                        aria-invalid={invalid}
                                      />
                                      {invalid && (
                                        <FieldError
                                          errors={field.state.meta.errors}
                                        />
                                      )}
                                    </Field>
                                  )
                                }}
                              </form.Field>
                            )}
                          </>
                        )}
                      </form.Subscribe>
                      <form.Field name="icon">
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          return (
                            <Field data-invalid={invalid}>
                              <FieldLabel htmlFor={`${id}-icon`}>
                                {t("catalogs:icon")}
                              </FieldLabel>
                              <Input
                                id={`${id}-icon`}
                                maxLength={100}
                                value={field.state.value ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value || null)
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
                      <form.Field name="hidden">
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          return (
                            <Field
                              orientation="horizontal"
                              data-invalid={invalid}
                            >
                              <Checkbox
                                id={`${id}-hidden`}
                                checked={field.state.value}
                                onBlur={field.handleBlur}
                                onCheckedChange={(value) =>
                                  field.handleChange(value === true)
                                }
                                aria-invalid={invalid}
                              />
                              <FieldLabel htmlFor={`${id}-hidden`}>
                                {t("catalogs:hidden")}
                              </FieldLabel>
                              {invalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                    </>
                  )}
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
                {kind === "menu" && registry.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {registry.error instanceof Error
                      ? registry.error.message
                      : t("common:operationFailed")}
                  </p>
                )}
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
