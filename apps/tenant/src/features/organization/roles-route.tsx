import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import type { OrganizationRoleDirectoryItem } from "@workspace/contracts"
import { getRoleDirectoryOptions } from "@/features/organization/organization-directories"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import * as z from "zod"
import {
  ErrorState,
  FormDialog,
  AdminPage,
  PermissionDeniedState,
} from "@workspace/admin"
import { ApiClientError } from "@workspace/api-client"
import { authErrorMessage } from "@workspace/admin/auth"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { builtInOrganizationRoleKeys } from "@workspace/permissions"
import { authClient } from "@/lib/auth-client"
import { RoleActionDialog, type RoleAction } from "./role-action-dialog"
import {
  getOrganizationRoleAccessOptions,
  organizationRolesKey,
} from "@/features/organization/organization-roles"

const rolesPath = "/app/organizations/$organizationId/roles"
type RoleTranslation = TFunction<["organization", "common", "auth"]>

const permissionLabelKeys = {
  "file:read": "rolePermission_file_read",
  "file:upload": "rolePermission_file_upload",
  "file:update": "rolePermission_file_update",
  "file:delete": "rolePermission_file_delete",
  "file:restore": "rolePermission_file_restore",
  "file:purge": "rolePermission_file_purge",
  "folder:read": "rolePermission_folder_read",
  "folder:create": "rolePermission_folder_create",
  "folder:update": "rolePermission_folder_update",
  "folder:delete": "rolePermission_folder_delete",
  "project:read": "rolePermission_project_read",
  "project:create": "rolePermission_project_create",
  "project:update": "rolePermission_project_update",
  "project:delete": "rolePermission_project_delete",
  "project:export": "rolePermission_project_export",
  "project:translate": "rolePermission_project_translate",
  "member:export": "rolePermission_member_export",
  "audit:export": "rolePermission_audit_export",
  "member:read": "rolePermission_member_read",
  "member:create": "rolePermission_member_create",
  "member:update": "rolePermission_member_update",
  "member:delete": "rolePermission_member_delete",
  "invitation:create": "rolePermission_invitation_create",
  "invitation:cancel": "rolePermission_invitation_cancel",
  "ac:read": "rolePermission_ac_read",
  "ac:create": "rolePermission_ac_create",
  "ac:update": "rolePermission_ac_update",
  "ac:delete": "rolePermission_ac_delete",
  "organization:update": "rolePermission_organization_update",
  "organization:delete": "rolePermission_organization_delete",
  "team:create": "rolePermission_team_create",
  "team:update": "rolePermission_team_update",
  "team:delete": "rolePermission_team_delete",
  "tenantSettings:read": "rolePermission_tenantSettings_read",
  "tenantSettings:update": "rolePermission_tenantSettings_update",
  "audit:read": "rolePermission_audit_read",
} as const

function createRoleSchema(t: RoleTranslation) {
  return z.object({
    role: z
      .string()
      .min(3, t("organization:roleNameInvalid"))
      .max(48, t("organization:roleNameInvalid"))
      .regex(/^[a-z0-9-]+$/, t("organization:roleNameInvalid"))
      .refine(
        (role) => !builtInOrganizationRoleKeys.includes(role as never),
        t("organization:roleNameInvalid")
      )
      .refine(
        (role) => !role.startsWith("platform"),
        t("organization:roleNameInvalid")
      ),
  })
}

function permissionLabel(resource: string, action: string, t: RoleTranslation) {
  const key =
    permissionLabelKeys[
      `${resource}:${action}` as keyof typeof permissionLabelKeys
    ]
  return key ? t(`organization:${key}`) : `${resource}: ${action}`
}

function RolePermissions({
  permission,
  t,
}: {
  permission: Record<string, readonly string[]>
  t: RoleTranslation
}) {
  const items = Object.entries(permission).flatMap(([resource, actions]) =>
    actions.map((action) => permissionLabel(resource, action, t))
  )
  return (
    <div className="space-y-1 text-sm leading-relaxed wrap-anywhere text-muted-foreground">
      <p>
        {t("organization:rolePermissionCount", {
          permissionCount: items.length,
        })}
      </p>
      <p>
        {items.length > 0
          ? items.join("、")
          : t("organization:roleNoPermissions")}
      </p>
    </div>
  )
}

const roleColumns = createDataTableColumnHelper<OrganizationRoleDirectoryItem>()
const EMPTY_ROLES: OrganizationRoleDirectoryItem[] = []

export function RolesRoute() {
  const { organizationId } = useParams({ from: rolesPath })
  const search = useSearch({ from: rolesPath })
  const navigate = useNavigate({ from: rolesPath })
  const { t } = useTranslation(["organization", "common", "auth"])
  const queryClient = useQueryClient()
  const [action, setAction] = useState<RoleAction | null>(null)
  const [creating, setCreating] = useState(false)
  const rolesTitle = useRef<HTMLDivElement>(null)
  const access = useQuery(getOrganizationRoleAccessOptions(organizationId))
  const roles = useQuery({
    ...getRoleDirectoryOptions(organizationId, search),
    enabled: access.data?.canRead === true,
  })
  const forbidden =
    roles.error instanceof ApiClientError && roles.error.status === 403
  useEffect(() => {
    if (!forbidden) return
    const filters = {
      queryKey: organizationRolesKey(organizationId),
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.at(-1) !== "access",
    }
    if (
      queryClient.getQueriesData(filters).some(([, data]) => data !== undefined)
    )
      void queryClient.resetQueries(filters)
  }, [forbidden, organizationId, queryClient])
  const [formError, setFormError] = useState<string | null>(null)
  const createRole = useMutation({
    mutationFn: async (input: {
      role: string
      permission: Record<string, string[]>
    }) => {
      const result = await authClient.organization.createRole({
        organizationId,
        role: input.role,
        permission: input.permission as never,
      })
      if (result.error) {
        if (result.error.code === "ROLE_NAME_INVALID")
          throw new Error(t("organization:roleNameInvalid"))
        if (result.error.code === "ROLE_NAME_IS_ALREADY_TAKEN")
          throw new Error(t("organization:roleNameAlreadyTaken"))
        if (result.error.code === "ROLE_PERMISSION_NOT_DELEGABLE")
          throw new Error(t("organization:rolePermissionDenied"))
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
      }
    },
    onSuccess: async () => {
      setFormError(null)
      await queryClient.invalidateQueries({
        queryKey: organizationRolesKey(organizationId),
      })
    },
    onError: (error) => setFormError(error.message),
  })
  const form = useForm({
    defaultValues: { role: "", permissions: [] as string[] },
    validators: {
      onSubmit: createRoleSchema(t).extend({
        permissions: z.array(z.string()),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null)
      const permission: Record<string, string[]> = {}
      for (const selected of value.permissions) {
        const separator = selected.lastIndexOf(":")
        const resource = selected.slice(0, separator)
        permission[resource] = [
          ...(permission[resource] ?? []),
          selected.slice(separator + 1),
        ]
      }
      try {
        await createRole.mutateAsync({ role: value.role, permission })
      } catch {
        return
      }
      formApi.reset()
      setCreating(false)
    },
  })
  const columns = useMemo(
    () =>
      roleColumns.columns([
        roleColumns.accessor("role", {
          header: t("organization:role"),
          cell: ({ row }) => (
            <span className="font-medium wrap-anywhere">
              {row.original.builtIn
                ? t(
                    `organization:role_${row.original.role as "owner" | "admin" | "member"}`
                  )
                : row.original.role}
            </span>
          ),
          size: 180,
          meta: { label: t("organization:role") },
        }),
        roleColumns.accessor("builtIn", {
          header: t("organization:roleKind"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <Badge variant={getValue() ? "secondary" : "outline"}>
              {t(
                getValue()
                  ? "organization:roleReadOnly"
                  : "organization:roleCustom"
              )}
            </Badge>
          ),
          size: 150,
          meta: {
            label: t("organization:roleKind"),
            facetMode: "single",
            facetOptions: [
              { value: "built-in", label: t("organization:builtInRoles") },
              { value: "custom", label: t("organization:customRoles") },
            ],
          },
        }),
        roleColumns.accessor("permission", {
          header: t("organization:rolePermissions"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <details className="min-w-40">
              <summary className="cursor-pointer text-sm">
                {t("organization:directoryPermissionCount", {
                  count: Object.values(getValue()).reduce(
                    (count, actions) => count + actions.length,
                    0
                  ),
                })}
              </summary>
              <div className="mt-2">
                <RolePermissions permission={getValue()} t={t} />
              </div>
            </details>
          ),
          size: 300,
          meta: { label: t("organization:rolePermissions") },
        }),
        roleColumns.accessor("memberCount", {
          header: t("organization:roleMembers"),
          enableSorting: false,
          size: 110,
          meta: { label: t("organization:roleMembers") },
        }),
        roleColumns.accessor("invitationCount", {
          header: t("organization:roleInvitations"),
          enableSorting: false,
          size: 130,
          meta: { label: t("organization:roleInvitations") },
        }),
        roleColumns.display({
          id: "actions",
          header: t("organization:directoryActions"),
          cell: ({ row }) =>
            row.original.builtIn ? (
              <span className="text-xs text-muted-foreground">
                {t("organization:roleReadOnly")}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {access.data?.canUpdate && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={(event) =>
                      setAction({
                        kind: "update",
                        role: row.original,
                        grantablePermissions: access.data!.grantablePermissions,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    {t("organization:editRolePermissions")}
                  </Button>
                )}
                {access.data?.canDelete && (
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={(event) =>
                      setAction({
                        kind: "delete",
                        role: row.original,
                        grantablePermissions: access.data!.grantablePermissions,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    {t("organization:deleteCustomRole")}
                  </Button>
                )}
              </div>
            ),
          size: 240,
        }),
      ]),
    [access.data, t]
  )
  if (access.isPending)
    return (
      <AdminPage title={t("organization:roles")}>
        <div role="status">{t("common:loading")}</div>
      </AdminPage>
    )
  if (access.error)
    return (
      <AdminPage title={t("organization:roles")}>
        {access.error instanceof ApiClientError &&
        access.error.body.code === "FORBIDDEN" ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState onRetry={() => void access.refetch()} />
        )}
      </AdminPage>
    )
  if (!access.data?.canRead)
    return (
      <AdminPage title={t("organization:roles")}>
        <PermissionDeniedState />
      </AdminPage>
    )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  const columnFilters = search.kind
    ? [{ id: "builtIn", value: search.kind }]
    : []
  return (
    <AdminPage
      title={t("organization:roles")}
      headingRef={rolesTitle}
      actions={
        !forbidden &&
        access.data.canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setFormError(null)
              setCreating(true)
            }}
          >
            {t("organization:createRole")}
          </Button>
        )
      }
    >
      <DataTable
        empty={<p>{t("organization:rolesEmpty")}</p>}
        columns={columns}
        data={forbidden ? EMPTY_ROLES : (roles.data?.items ?? EMPTY_ROLES)}
        getRowId={(row) => row.id}
        rowCount={forbidden ? 0 : (roles.data?.total ?? 0)}
        status={forbidden ? "forbidden" : getDataTableQueryStatus(roles)}
        error={roles.error?.message}
        onRetry={() => void roles.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableRowSelection={false}
        enableMultiSort={false}
        state={{
          pagination,
          sorting,
          columnFilters,
          globalFilter: search.q ?? "",
        }}
        searchPlaceholder={t("organization:searchRoles")}
        searchMaxLength={120}
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, page: 1, q: q || undefined } })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const kind = next.find((filter) => filter.id === "builtIn")?.value
          void navigate({
            search: {
              ...search,
              page: 1,
              kind: kind === "built-in" || kind === "custom" ? kind : undefined,
            },
          })
        }}
        onSortingChange={(updater) => {
          const next = (
            typeof updater === "function" ? updater(sorting) : updater
          )[0]
          void navigate({
            search: {
              ...search,
              page: 1,
              sortBy: next?.id === "createdAt" ? "createdAt" : "role",
              sortOrder: next?.desc ? "desc" : "asc",
            },
          })
        }}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          void navigate({
            search: {
              ...search,
              page: next.pageIndex + 1,
              pageSize: next.pageSize,
            },
          })
        }}
        onResetFilters={() =>
          void navigate({
            search: { ...search, page: 1, q: undefined, kind: undefined },
          })
        }
      />
      {action && (
        <RoleActionDialog
          key={action.role.id + action.kind}
          organizationId={organizationId}
          action={action}
          onClose={() => setAction(null)}
          successFocus={rolesTitle}
          permissionLabel={(resource, item) =>
            permissionLabel(resource, item, t)
          }
        />
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <FormDialog
            open={creating}
            onOpenChange={setCreating}
            title={t("organization:createRole")}
            description={t("organization:roleKeyDescription")}
            onSubmit={() => void form.handleSubmit()}
            pending={submitting}
            error={formError ?? undefined}
            submitLabel={t("organization:createRole")}
            contentClassName="max-h-[calc(100dvh-2rem)] overflow-y-auto"
            contentTabIndex={0}
          >
            <FieldGroup>
              <form.Field name="role">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="custom-role-key">
                        {t("organization:roleKey")}
                      </FieldLabel>
                      <Input
                        id="custom-role-key"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        minLength={3}
                        maxLength={48}
                        autoComplete="off"
                        required
                        aria-invalid={invalid}
                      />
                      <FieldDescription>
                        {t("organization:roleKeyDescription")}
                      </FieldDescription>
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="permissions" mode="array">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel>
                        {t("organization:rolePermissions")}
                      </FieldLabel>
                      <FieldGroup data-slot="checkbox-group">
                        {access.data?.grantablePermissions.map(
                          ({ resource, action }) => {
                            const key = `${resource}:${action}`
                            const index = field.state.value.indexOf(key)
                            return (
                              <label
                                key={key}
                                className="flex items-start gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={index >= 0}
                                  disabled={submitting}
                                  aria-invalid={invalid}
                                  onBlur={field.handleBlur}
                                  onCheckedChange={(checked) => {
                                    if (checked === true) field.pushValue(key)
                                    else field.removeValue(index)
                                  }}
                                />
                                {permissionLabel(resource, action, t)}
                              </label>
                            )
                          }
                        )}
                      </FieldGroup>
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
    </AdminPage>
  )
}
