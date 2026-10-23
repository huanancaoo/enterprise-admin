import { useCallback, useId, useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  listPlatformRoles,
  getPlatformRole,
  createPlatformRole,
  updatePlatformRole,
  setPlatformRoleStatus,
  deletePlatformRole,
  setPlatformRolePermissions,
  listPlatformRoleEmployees,
  assignPlatformRoleEmployees,
  revokePlatformRoleEmployees,
  getPlatformMenuRegistry,
} from "@workspace/api-client"
import {
  PlatformRoleSchema,
  PlatformRolesPageSchema,
  CreatePlatformRoleSchema,
  PlatformEmployeesPageSchema,
  PlatformMenuRegistrySchema,
  SetPlatformRolePermissionsSchema,
  type PlatformRole,
  type PlatformEmployee,
} from "@workspace/contracts/platform-system"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { ErrorState, LoadingState, AdminPage } from "@workspace/admin"
import {
  DataTable,
  getDataTableQueryStatus,
  createDataTableColumnHelper,
  createDataTableSelectColumn,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Badge } from "@workspace/ui/components/badge"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { ArrowLeftIcon } from "lucide-react"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { PlatformExportButton } from "../tasks/task-actions"
import { DirectoryError } from "./employee-role-fields"
import {
  localizedDirectoryValidation,
  useRefreshPlatformAuthority,
} from "./employee-role-utils"

const roleColumns = createDataTableColumnHelper<PlatformRole>()
const employeeColumns = createDataTableColumnHelper<PlatformEmployee>()
const EMPTY_ROLES: PlatformRole[] = []
const EMPTY_EMPLOYEES: PlatformEmployee[] = []

export function PlatformRolesPage() {
  const refreshAuthority = useRefreshPlatformAuthority()
  const { t } = useTranslation("roles")
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const search = useSearch({ from: "/platform/roles" })
  const navigate = useNavigate({ from: "/platform/roles" })
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<PlatformRole | "new" | null>(null)
  const [deleting, setDeleting] = useState<PlatformRole | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const canCreate = platformAccess.permissions.includes("platform.role:create")
  const canUpdate = platformAccess.permissions.includes("platform.role:update")
  const canDelete = platformAccess.permissions.includes("platform.role:delete")
  const canAuthorize = platformAccess.permissions.includes(
    "platform.authorization:manage"
  )
  const query = useQuery({
    queryKey: ["platform", session.user.id, "roles", search],
    queryFn: async ({ signal }) =>
      PlatformRolesPageSchema.parse(
        (await listPlatformRoles(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error ?? error)
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["platform", session.user.id, "roles"],
    })
  }, [queryClient, session.user.id])
  const columns = useMemo(
    () =>
      roleColumns.columns([
        roleColumns.accessor("name", {
          header: t("name"),
          size: 200,
          meta: { label: t("name") },
        }),
        roleColumns.accessor("key", {
          header: t("key"),
          size: 200,
          cell: ({ getValue }) => (
            <bdi className="font-mono text-xs">{getValue()}</bdi>
          ),
          meta: { label: t("key") },
        }),
        roleColumns.accessor("status", {
          header: t("status"),
          cell: ({ getValue }) => (
            <Badge variant={getValue() === "active" ? "secondary" : "outline"}>
              {t(getValue())}
            </Badge>
          ),
          meta: { label: t("status") },
        }),
        roleColumns.accessor("builtIn", {
          header: t("source"),
          cell: ({ getValue }) => t(getValue() ? "builtIn" : "custom"),
          meta: { label: t("source") },
        }),
        roleColumns.accessor("sort", {
          header: t("sort"),
          size: 80,
          meta: { label: t("sort") },
        }),
        roleColumns.display({
          id: "actions",
          header: t("actions"),
          size: 380,
          meta: { label: t("actions"), configurable: false },
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              {canUpdate && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setEditing(row.original)}
                >
                  {t("edit")}
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to="/platform/roles/$roleId/permissions"
                    params={{ roleId: row.original.id }}
                  />
                }
              >
                {t("permissions")}
              </Button>
              {canAuthorize && (
                <Button
                  size="xs"
                  variant="ghost"
                  nativeButton={false}
                  render={
                    <Link
                      to="/platform/roles/$roleId/employees"
                      params={{ roleId: row.original.id }}
                      search={{
                        assigned: true,
                        page: 1,
                        pageSize: 20,
                        sortBy: "createdAt",
                        sortOrder: "desc",
                      }}
                    />
                  }
                >
                  {t("employees")}
                </Button>
              )}
              {canUpdate && row.original.key !== "platform_admin" && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true)
                    setError(undefined)
                    try {
                      const role = row.original
                      await setPlatformRoleStatus(role.id, {
                        status:
                          role.status === "active" ? "disabled" : "active",
                      })
                      await refreshAuthority()
                      await refresh()
                    } catch (failure) {
                      setError(failure)
                    } finally {
                      setPending(false)
                    }
                  }}
                >
                  {t(row.original.status === "active" ? "disable" : "enable")}
                </Button>
              )}
              {canDelete && row.original.key !== "platform_admin" && (
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    setError(undefined)
                    setDeleting(row.original)
                  }}
                >
                  {t("delete")}
                </Button>
              )}
            </div>
          ),
        }),
      ]),
    [t, canUpdate, canDelete, canAuthorize, pending, refresh, refreshAuthority]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  return (
    <AdminPage
      title={t("title")}
      actions={
        getDataTableQueryStatus(query) !== "forbidden" &&
        canCreate && (
          <Button disabled={pending} onClick={() => setEditing("new")}>
            {t("create")}
          </Button>
        )
      }
    >
      <DirectoryError error={error} />
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_ROLES}
        getRowId={(row) => row.id}
        rowCount={query.data?.total ?? 0}
        status={getDataTableQueryStatus(query)}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        isActionPending={pending}
        searchPlaceholder={t("search")}
        searchMaxLength={200}
        toolbarActions={
          <>
            {platformAccess.permissions.includes("platform.role:export") && (
              <PlatformExportButton resource="role" filters={search} />
            )}
          </>
        }
        toolbarFilters={
          <Select
            items={{
              all: t("allStatuses"),
              active: t("active"),
              disabled: t("disabled"),
            }}
            value={search.status ?? "all"}
            onValueChange={(value) => {
              if (value)
                void navigate({
                  search: {
                    ...search,
                    page: 1,
                    status:
                      value === "all"
                        ? undefined
                        : (value as "active" | "disabled"),
                  },
                })
            }}
          >
            <SelectTrigger size="sm" aria-label={t("status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              <SelectItem value="active">{t("active")}</SelectItem>
              <SelectItem value="disabled">{t("disabled")}</SelectItem>
            </SelectContent>
          </Select>
        }
        state={{
          globalFilter: search.q ?? "",
          pagination,
          columnFilters: search.status
            ? [{ id: "status", value: search.status }]
            : [],
        }}
        onResetFilters={() =>
          void navigate({
            search: { ...search, page: 1, q: undefined, status: undefined },
          })
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, page: 1, q: q || undefined } })
        }}
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
      {editing && (
        <RoleEditor
          role={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null)
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {deleting && t("deleteTitle", { name: deleting.name })}
            </DialogTitle>
            <DialogDescription>{t("deleteDescription")}</DialogDescription>
          </DialogHeader>
          <DirectoryError error={error} />
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                if (!deleting) return
                setPending(true)
                setError(undefined)
                try {
                  await deletePlatformRole(deleting.id)
                  setDeleting(null)
                  await refreshAuthority()
                  await refresh()
                } catch (failure) {
                  setError(failure)
                } finally {
                  setPending(false)
                }
              }}
            >
              {pending ? t("saving") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}

export function RoleEditor({
  role,
  onClose,
  onSaved,
}: {
  role?: PlatformRole
  onClose: () => void
  onSaved: () => void
}) {
  const refreshAuthority = useRefreshPlatformAuthority()
  const { t } = useTranslation("roles")
  const id = useId()
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: {
      key: role?.key ?? "",
      name: role?.name ?? "",
      sort: role?.sort ?? 0,
      status: role?.status ?? ("active" as "active" | "disabled"),
    },
    validators: {
      onSubmit: localizedDirectoryValidation(CreatePlatformRoleSchema, {
        key: t("invalidKey"),
        name: t("invalidName"),
        sort: t("invalidSort"),
        status: t("invalidStatus"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        if (role) await updatePlatformRole(role.id, value)
        else await createPlatformRole(value)
        if (role && value.status !== role.status) await refreshAuthority()
        onSaved()
      } catch (failure) {
        setError(failure)
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) onClose()
          }}
        >
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>{t(role ? "edit" : "create")}</DialogTitle>
              <DialogDescription>{t("editorDescription")}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={pending} className="space-y-4">
                <FieldGroup className="gap-4">
                  {(["name", "key"] as const).map((name) => (
                    <form.Field key={name} name={name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-${name}`}>
                              {t(name)}
                            </FieldLabel>
                            <Input
                              id={`${id}-${name}`}
                              value={field.state.value}
                              required
                              maxLength={name === "key" ? 120 : 200}
                              disabled={
                                role?.key === "platform_admin" && name === "key"
                              }
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
                  ))}
                  <form.Field name="sort">
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field data-invalid={invalid} className="max-w-36">
                          <FieldLabel htmlFor={`${id}-sort`}>
                            {t("sort")}
                          </FieldLabel>
                          <Input
                            id={`${id}-sort`}
                            type="number"
                            min={0}
                            max={2147483647}
                            step={1}
                            required
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.target.valueAsNumber)
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
                  <form.Field name="status">
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field data-invalid={invalid}>
                          <FieldLabel htmlFor={`${id}-status`}>
                            {t("status")}
                          </FieldLabel>
                          <Select
                            items={{
                              active: t("active"),
                              disabled: t("disabled"),
                            }}
                            value={field.state.value}
                            onValueChange={(value) => {
                              if (value) field.handleChange(value)
                            }}
                            disabled={role?.key === "platform_admin"}
                          >
                            <SelectTrigger
                              id={`${id}-status`}
                              size="sm"
                              onBlur={field.handleBlur}
                              aria-invalid={invalid}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">
                                {t("active")}
                              </SelectItem>
                              <SelectItem value="disabled">
                                {t("disabled")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          {invalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                </FieldGroup>
                <DirectoryError error={error} />
                <DialogFooter>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onClose}
                  >
                    {t("cancel")}
                  </Button>
                  <Button size="sm" type="submit">
                    {pending ? t("saving") : t("save")}
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

function RolePage({
  role,
  title,
  children,
}: {
  role?: PlatformRole
  title: string
  children: React.ReactNode
}) {
  const { t } = useTranslation("roles")
  const { platformAccess } = useRouteContext({ from: "/platform" })
  return (
    <AdminPage
      title={title}
      back={
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={
            <Link
              to="/platform/roles"
              search={{
                page: 1,
                pageSize: 20,
                sortBy: "sort",
                sortOrder: "asc",
              }}
            />
          }
        >
          <ArrowLeftIcon />
          {t("back")}
        </Button>
      }
      meta={
        role && (
          <p className="flex flex-wrap items-center gap-3 pt-2 text-base font-medium text-foreground">
            {role.name}
            <bdi className="rounded-md bg-muted px-2 py-1 font-mono text-sm font-normal">
              {role.key}
            </bdi>
          </p>
        )
      }
      subnav={
        role && (
          <nav
            aria-label={t("title")}
            className="flex flex-wrap gap-6 border-b"
          >
            <Link
              to="/platform/roles/$roleId/permissions"
              params={{ roleId: role.id }}
              activeProps={{ "aria-current": "page" }}
              className="border-b-2 border-transparent px-1 py-3 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary"
            >
              {t("permissions")}
            </Link>
            {platformAccess.permissions.includes(
              "platform.authorization:manage"
            ) && (
              <Link
                to="/platform/roles/$roleId/employees"
                params={{ roleId: role.id }}
                search={{
                  assigned: true,
                  page: 1,
                  pageSize: 20,
                  sortBy: "createdAt",
                  sortOrder: "desc",
                }}
                activeProps={{ "aria-current": "page" }}
                className="border-b-2 border-transparent px-1 py-3 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary"
              >
                {t("employees")}
              </Link>
            )}
          </nav>
        )
      }
    >
      {children}
    </AdminPage>
  )
}

export function PlatformRolePermissionsPage() {
  const { t } = useTranslation("roles")
  const { roleId } = useParams({ from: "/platform/roles/$roleId/permissions" })
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const canManage = platformAccess.permissions.includes(
    "platform.authorization:manage"
  )
  const query = useQuery({
    queryKey: ["platform", session.user.id, "role", roleId],
    queryFn: async ({ signal }) =>
      PlatformRoleSchema.parse(
        (await getPlatformRole(roleId, { signal })).data
      ),
    retry: false,
  })
  const registry = useQuery({
    queryKey: ["platform", session.user.id, "menu-registry"],
    enabled: canManage,
    queryFn: async ({ signal }) =>
      PlatformMenuRegistrySchema.parse(
        (await getPlatformMenuRegistry({ signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error ?? (canManage ? registry.error : null))
  if (query.isPending || (canManage && registry.isPending))
    return (
      <RolePage title={t("permissionsTitle")}>
        <LoadingState />
      </RolePage>
    )
  if (query.isError || (canManage && registry.isError))
    return (
      <RolePage title={t("permissionsTitle")}>
        <ErrorState
          message={(query.error ?? registry.error)?.message}
          onRetry={() => {
            void query.refetch()
            if (canManage) void registry.refetch()
          }}
        />
      </RolePage>
    )
  return (
    <RolePage role={query.data} title={t("permissionsTitle")}>
      <RolePermissionsForm
        key={`${query.data.id}-${query.data.updatedAt}`}
        role={query.data}
        actions={
          canManage
            ? registry.data!.actions.map((action) => action.key)
            : query.data.permissions
        }
        editable={
          platformAccess.permissions.includes(
            "platform.authorization:manage"
          ) && query.data.key !== "platform_admin"
        }
        onSaved={() => void query.refetch()}
      />
    </RolePage>
  )
}

export function RolePermissionsForm({
  role,
  actions,
  editable,
  onSaved,
}: {
  role: PlatformRole
  actions: string[]
  editable: boolean
  onSaved: () => void
}) {
  const refreshAuthority = useRefreshPlatformAuthority()
  const { t } = useTranslation("roles")
  const id = useId()
  const [error, setError] = useState<unknown>()
  const [saved, setSaved] = useState(false)
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: { permissions: role.permissions },
    validators: {
      onSubmit: localizedDirectoryValidation(SetPlatformRolePermissionsSchema, {
        permissions: t("invalidPermissions"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      setSaved(false)
      try {
        await setPlatformRolePermissions(role.id, value)
        await refreshAuthority()
        setSaved(true)
        onSaved()
      } catch (failure) {
        setError(failure)
      }
    },
  })
  const resourceLabels: Record<string, string> = {
    file: t("permissionResourceFile"),
    folder: t("permissionResourceFolder"),
    announcement: t("permissionResourceAnnouncement"),
    audit: t("permissionResourceAudit"),
    department: t("permissionResourceDepartment"),
    dictionary: t("permissionResourceDictionary"),
    employee: t("permissionResourceEmployee"),
    login: t("permissionResourceLogin"),
    menu: t("permissionResourceMenu"),
    monitor: t("permissionResourceMonitor"),
    schedule: t("permissionResourceSchedule"),
    organization: t("permissionResourceOrganization"),
    parameter: t("permissionResourceParameter"),
    post: t("permissionResourcePost"),
    role: t("permissionResourceRole"),
    session: t("permissionResourceSession"),
    settings: t("permissionResourceSettings"),
    task: t("permissionResourceTask"),
    user: t("permissionResourceUser"),
  }
  const actionLabels: Record<string, string> = {
    restore: t("permissionActionRestore"),
    purge: t("permissionActionPurge"),
    create: t("permissionActionCreate"),
    delete: t("permissionActionDelete"),
    download: t("permissionActionDownload"),
    export: t("permissionActionExport"),
    import: t("permissionActionImport"),
    manage: t("permissionActionManage"),
    publish: t("permissionActionPublish"),
    read: t("permissionActionRead"),
    readers: t("permissionActionReaders"),
    readSensitive: t("permissionActionReadSensitive"),
    refresh: t("permissionActionRefresh"),
    resetPassword: t("permissionActionResetPassword"),
    resume: t("permissionActionResume"),
    revoke: t("permissionActionRevoke"),
    run: t("permissionActionRun"),
    suspend: t("permissionActionSuspend"),
    unlock: t("permissionActionUnlock"),
    update: t("permissionActionUpdate"),
    withdraw: t("permissionActionWithdraw"),
  }
  const groups = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const action of actions) {
      if (action === "platform.authorization:manage") continue
      const resource = action.split(":")[0]!
      ;(result[resource] ??= []).push(action)
    }
    return result
  }, [actions])
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t("actionPermissions")}</h2>
        <p className="text-sm text-muted-foreground">
          {role.key === "platform_admin"
            ? t("builtInPermissions")
            : t("permissionsDescription")}
        </p>
      </div>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <form
            noValidate
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <fieldset disabled={pending || !editable} className="space-y-4">
              <form.Field name="permissions" mode="array">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel className="sr-only">
                        {t("actionPermissions")}
                      </FieldLabel>
                      <FieldGroup
                        data-slot="checkbox-group"
                        className="gap-0 divide-y border-y"
                      >
                        {Object.entries(groups).map(([group, keys]) => (
                          <div
                            key={group}
                            role="group"
                            aria-labelledby={`${id}-${group}`}
                            className="grid gap-4 py-5 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6"
                          >
                            <h3
                              id={`${id}-${group}`}
                              className="text-sm font-medium"
                            >
                              {resourceLabels[group.slice("platform.".length)]}
                            </h3>
                            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                              {keys?.map((key) => (
                                <label
                                  key={key}
                                  htmlFor={`${id}-${key}`}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <Checkbox
                                    id={`${id}-${key}`}
                                    checked={field.state.value.includes(key)}
                                    onBlur={field.handleBlur}
                                    aria-invalid={invalid}
                                    aria-labelledby={`${id}-${group} ${id}-${key}-label`}
                                    onCheckedChange={(checked) => {
                                      if (checked) field.pushValue(key)
                                      else
                                        void field.removeValue(
                                          field.state.value.indexOf(key)
                                        )
                                    }}
                                  />
                                  <span
                                    id={`${id}-${key}-label`}
                                    className="min-w-0"
                                  >
                                    {actionLabels[key.split(":")[1]!]}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </FieldGroup>
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <DirectoryError error={error} />
              {editable && (
                <Button type="submit">
                  {pending ? t("saving") : t("savePermissions")}
                </Button>
              )}
            </fieldset>
            {saved && (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {t("permissionsSaved")}
              </p>
            )}
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}

export function PlatformRoleEmployeesPage() {
  const refreshAuthority = useRefreshPlatformAuthority()
  const { t } = useTranslation("roles")
  const { roleId } = useParams({ from: "/platform/roles/$roleId/employees" })
  const search = useSearch({ from: "/platform/roles/$roleId/employees" })
  const navigate = useNavigate({ from: "/platform/roles/$roleId/employees" })
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const [selected, setSelected] = useState<PlatformEmployee[]>([])
  const canManage = platformAccess.permissions.includes(
    "platform.authorization:manage"
  )
  const role = useQuery({
    queryKey: ["platform", session.user.id, "role", roleId],
    queryFn: async ({ signal }) =>
      PlatformRoleSchema.parse(
        (await getPlatformRole(roleId, { signal })).data
      ),
    retry: false,
  })
  const query = useQuery({
    queryKey: ["platform", session.user.id, "role-employees", roleId, search],
    queryFn: async ({ signal }) =>
      PlatformEmployeesPageSchema.parse(
        (
          await listPlatformRoleEmployees(
            roleId,
            { ...search, assigned: search.assigned },
            { signal }
          )
        ).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error ?? role.error ?? error)
  const columns = useMemo(
    () =>
      employeeColumns.columns([
        ...(canManage ? [createDataTableSelectColumn<PlatformEmployee>()] : []),
        employeeColumns.accessor("name", {
          header: t("employeeName"),
          size: 220,
          cell: ({ row, getValue }) => (
            <Link
              to="/platform/employees/$employeeId"
              params={{ employeeId: row.original.userId }}
              className="font-medium hover:underline"
            >
              {getValue()}
            </Link>
          ),
          meta: { label: t("employeeName") },
        }),
        employeeColumns.accessor("maskedEmail", {
          header: t("employeeEmail"),
          size: 230,
          cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
          meta: { label: t("employeeEmail") },
        }),
        employeeColumns.accessor("status", {
          header: t("status"),
          cell: ({ getValue }) => (
            <Badge variant={getValue() === "active" ? "secondary" : "outline"}>
              {t(getValue())}
            </Badge>
          ),
          meta: { label: t("status") },
        }),
        ...(canManage
          ? [
              employeeColumns.display({
                id: "actions",
                header: t("actions"),
                size: 140,
                cell: ({ row }) => (
                  <Button
                    size="xs"
                    variant={search.assigned ? "destructive" : "outline"}
                    disabled={pending}
                    onClick={() => {
                      setError(undefined)
                      setSelected([row.original])
                    }}
                  >
                    {t(search.assigned ? "revoke" : "assign")}
                  </Button>
                ),
                meta: { label: t("actions"), configurable: false },
              }),
            ]
          : []),
      ]),
    [t, canManage, pending, search.assigned]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  if (role.isPending)
    return (
      <AdminPage title={t("employeesTitle")}>
        <LoadingState />
      </AdminPage>
    )
  if (role.isError)
    return (
      <AdminPage title={t("employeesTitle")}>
        <ErrorState
          message={role.error.message}
          onRetry={() => void role.refetch()}
        />
      </AdminPage>
    )
  return (
    <RolePage role={role.data} title={t("employeesTitle")}>
      <Tabs
        value={search.assigned ? "assigned" : "unassigned"}
        onValueChange={(value) => {
          void navigate({
            search: { ...search, assigned: value === "assigned", page: 1 },
          })
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="assigned">{t("assigned")}</TabsTrigger>
          <TabsTrigger value="unassigned">{t("unassigned")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_EMPLOYEES}
        getRowId={(row) => row.userId}
        rowCount={query.data?.total ?? 0}
        status={getDataTableQueryStatus(query)}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={canManage}
        isActionPending={pending}
        searchPlaceholder={t("employeesSearch")}
        searchMaxLength={200}
        state={{ globalFilter: search.q ?? "", pagination }}
        onResetFilters={() =>
          void navigate({
            search: {
              ...search,
              page: 1,
              q: undefined,
              status: undefined,
              departmentId: undefined,
            },
          })
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, page: 1, q: q || undefined } })
        }}
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
        renderSelectionActions={(rows) => (
          <Button
            size="sm"
            variant={search.assigned ? "destructive" : "default"}
            disabled={pending}
            onClick={() => {
              setError(undefined)
              setSelected(rows.map((row) => row.original))
            }}
          >
            {t(search.assigned ? "revokeSelected" : "assignSelected", {
              count: rows.length,
            })}
          </Button>
        )}
      />
      <Dialog
        open={selected.length > 0}
        onOpenChange={(open) => {
          if (!open && !pending) setSelected([])
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {t(search.assigned ? "revokeSelected" : "assignSelected", {
                count: selected.length,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(search.assigned ? "revokeDescription" : "assignDescription", {
                name: role.data.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DirectoryError error={error} />
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setSelected([])}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={pending}
              variant={search.assigned ? "destructive" : "default"}
              onClick={async () => {
                setPending(true)
                setError(undefined)
                try {
                  const body = {
                    userIds: selected.map((employee) => employee.userId),
                  }
                  if (search.assigned)
                    await revokePlatformRoleEmployees(roleId, body)
                  else await assignPlatformRoleEmployees(roleId, body)
                  setSelected([])
                  await refreshAuthority()
                  await queryClient.invalidateQueries({
                    queryKey: [
                      "platform",
                      session.user.id,
                      "role-employees",
                      roleId,
                    ],
                  })
                  await queryClient.invalidateQueries({
                    queryKey: ["platform", session.user.id, "employees"],
                  })
                } catch (failure) {
                  setError(failure)
                } finally {
                  setPending(false)
                }
              }}
            >
              {pending ? t("saving") : t(search.assigned ? "revoke" : "assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RolePage>
  )
}
