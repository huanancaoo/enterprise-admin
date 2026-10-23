import { useId, useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { KeyRoundIcon, PlusIcon } from "lucide-react"
import {
  ApiClientError,
  createAccessCredential,
  listAccessCredentials,
  revokeAccessCredential,
  getOrganizationRoleAccess,
} from "@workspace/api-client"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { useOrganizationAuthorization } from "@/hooks/use-organization-authorization"
import type { AccessCredential } from "@workspace/contracts"
import { permissionStatements } from "@workspace/permissions"
import {
  FormDialog,
  ConfirmDangerAction,
  AdminPage,
  LoadingState,
  PermissionDeniedState,
  ErrorState,
} from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Badge } from "@workspace/ui/components/badge"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/components/dialog"

const supportedScopes = new Set([
  "project",
  "file",
  "folder",
  "tenantSettings",
  "audit",
  "integration",
])
const columnHelper = createDataTableColumnHelper<AccessCredential>()
function credentialFormSchema(messages: {
  name: string
  expiry: string
  permission: string
}) {
  return z.strictObject({
    name: z.string().trim().min(1, messages.name).max(64),
    expiry: z
      .string()
      .refine((value) => Date.parse(value) > Date.now(), messages.expiry),
    selected: z.array(z.string()).min(1, messages.permission),
  })
}
function scopeRecord(selected: string[]): Record<string, string[]> {
  const permissions: Record<string, string[]> = {}
  for (const value of selected) {
    const [resource, action] = value.split(":")
    ;(permissions[resource] ??= []).push(action)
  }
  return permissions
}

export function AccessCredentialsSettings({
  organizationId,
}: {
  organizationId: string
}) {
  const { t } = useTranslation("credentials")

  const session = useAuthenticatedSession()!
  const membership = useOrganizationAuthorization({
    organizationId,
    userId: session.user.id,
    observation: "access-credentials",
  })
  if (membership.error)
    return (
      <AdminPage title={t("title")}>
        {membership.error instanceof ApiClientError &&
        [401, 403].includes(membership.error.status) ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState onRetry={() => void membership.refetch()} />
        )}
      </AdminPage>
    )
  if (membership.isPending)
    return (
      <AdminPage title={t("title")}>
        <LoadingState />
      </AdminPage>
    )
  const { authorizationVersion, scopeKey } = membership.data
  // 用户、组织或权威授权版本变化都会销毁一次性密钥和当前草稿。
  return (
    <CredentialScope
      key={scopeKey}
      organizationId={organizationId}
      userId={session.user.id}
      authorizationVersion={authorizationVersion}
    />
  )
}
function useCredentialQueries({
  organizationId,
  userId,
  authorizationVersion,
}: {
  organizationId: string
  userId: string
  authorizationVersion: number
}) {
  const client = useQueryClient()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const scope = [
    "organizations",
    organizationId,
    "users",
    userId,
    "authorization",
    authorizationVersion,
  ]
  const prefix = [...scope, "access-credentials"]
  const access = useQuery({
    queryKey: [...scope, "credential-access"],
    retry: false,
    queryFn: ({ signal }) =>
      getOrganizationRoleAccess(organizationId, { signal }),
  })
  const listing = useQuery({
    queryKey: [...prefix, pagination],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await listAccessCredentials(
        organizationId,
        { page: pagination.pageIndex + 1, pageSize: pagination.pageSize },
        { signal }
      )
      return { ...result, observedAt: Date.now() }
    },
  })
  return { client, prefix, pagination, setPagination, access, listing }
}
function CredentialScope(props: {
  organizationId: string
  userId: string
  authorizationVersion: number
}) {
  const { t } = useTranslation("credentials")

  const data = useCredentialQueries(props)
  const error = data.listing.error ?? data.access.error
  // 权限失效卸载持有密钥的管理器，旧缓存不能继续显示本人元数据或创建结果。
  if (error instanceof ApiClientError && [401, 403].includes(error.status))
    return (
      <AdminPage title={t("title")}>
        <PermissionDeniedState />
      </AdminPage>
    )
  return <CredentialManager organizationId={props.organizationId} data={data} />
}
function CredentialManager({
  organizationId,
  data,
}: {
  organizationId: string
  data: ReturnType<typeof useCredentialQueries>
}) {
  const { t, i18n } = useTranslation(["credentials", "common"])
  const { client, prefix, pagination, setPagination, access, listing } = data
  const id = useId()
  const [createOpen, setCreateOpen] = useState(false)
  const [secret, setSecret] = useState<string>()
  const [copy, setCopy] = useState<"copied" | "failed">()
  const [revokeId, setRevokeId] = useState<string>()
  const canManage =
    access.data?.data.grantablePermissions.some(
      (permission) =>
        permission.resource === "integration" && permission.action === "manage"
    ) === true
  const choices =
    access.data?.data.grantablePermissions.filter(
      (permission) =>
        supportedScopes.has(permission.resource) &&
        Object.entries(permissionStatements).some(
          ([resource, actions]) =>
            resource === permission.resource &&
            actions.some((action) => action === permission.action)
        )
    ) ?? []
  const permissionGroups: Record<string, typeof choices> = {}
  for (const permission of choices) {
    ;(permissionGroups[permission.resource] ??= []).push(permission)
  }
  const create = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async (value: {
      name: string
      expiry: string
      selected: string[]
    }) => {
      const result = await createAccessCredential(organizationId, {
        name: value.name,
        expiresAt: new Date(value.expiry).toISOString(),
        permissions: scopeRecord(value.selected),
      })
      // 密钥只存在当前展示状态；mutation/query cache 不保留含密钥的响应。
      const { key, ...metadata } = result.data
      setSecret(key)
      return metadata
    },
    onSuccess: async () => {
      setCreateOpen(false)
      setPagination((value) => ({ ...value, pageIndex: 0 }))
      await client.invalidateQueries({ queryKey: prefix })
    },
  })
  const revoke = useMutation({
    retry: false,
    mutationFn: (credentialId: string) =>
      revokeAccessCredential(organizationId, credentialId),
    onSuccess: async () => {
      setRevokeId(undefined)
      await client.invalidateQueries({ queryKey: prefix })
    },
  })
  const schema = useMemo(
    () =>
      credentialFormSchema({
        name: t("nameRequired"),
        expiry: t("futureExpiry"),
        permission: t("permissionRequired"),
      }),
    [t]
  )
  const form = useForm({
    defaultValues: { name: "", expiry: "", selected: [] as string[] },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await create.mutateAsync(value)
        formApi.reset()
      } catch {
        /* 错误保留在 mutation，草稿保持原值。 */
      }
    },
  })
  const resourceLabels: Record<string, string> = {
    project: t("resourceProject"),
    file: t("resourceFile"),
    folder: t("resourceFolder"),
    tenantSettings: t("resourceSettings"),
    audit: t("resourceAudit"),
    integration: t("resourceIntegration"),
    member: t("resourceMember"),
  }
  const actionLabels: Record<string, string> = {
    read: t("actionRead"),
    create: t("actionCreate"),
    update: t("actionUpdate"),
    delete: t("actionDelete"),
    export: t("actionExport"),
    translate: t("actionTranslate"),
    upload: t("actionUpload"),
    restore: t("actionRestore"),
    purge: t("actionPurge"),
    manage: t("actionManage"),
  }
  const permissionLabel = (resource: string, action: string) =>
    t("permissionOption", {
      resource: resourceLabels[resource],
      action: actionLabels[action],
    })
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))
  const columns = columnHelper.columns([
    columnHelper.accessor("name", { header: t("name") }),
    columnHelper.display({
      id: "permissions",
      header: t("permissions"),
      cell: (cell) => (
        <ul className="space-y-1 text-sm">
          {Object.entries(cell.row.original.permissions).flatMap(
            ([resource, actions]) =>
              actions.map((action) => (
                <li key={`${resource}:${action}`}>
                  {permissionLabel(resource, action)}
                </li>
              ))
          )}
        </ul>
      ),
    }),
    columnHelper.accessor("createdAt", {
      header: t("createdAt"),
      cell: (cell) => date(cell.getValue()),
    }),
    columnHelper.accessor("expiresAt", {
      header: t("expiresAt"),
      cell: (cell) => date(cell.getValue()),
    }),
    columnHelper.display({
      id: "status",
      header: t("status"),
      cell: (cell) => (
        <Badge variant={cell.row.original.enabled ? "secondary" : "outline"}>
          {!cell.row.original.enabled
            ? t("revoked")
            : listing.data &&
                Date.parse(cell.row.original.expiresAt) <=
                  listing.data.observedAt
              ? t("expired")
              : t("active")}
        </Badge>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: t("revoke"),
      cell: (cell) =>
        canManage && cell.row.original.enabled ? (
          <ConfirmDangerAction
            triggerLabel={t("revoke")}
            title={t("revokeTitle")}
            description={t("revokeDescription", {
              name: cell.row.original.name,
            })}
            cancelLabel={t("common:cancel")}
            confirmLabel={t("revoke")}
            pendingLabel={t("common:submitting")}
            pending={revoke.isPending}
            open={revokeId === cell.row.original.id}
            onOpenChange={(open) => {
              revoke.reset()
              setRevokeId(open ? cell.row.original.id : undefined)
            }}
            onConfirm={() => revoke.mutate(cell.row.original.id)}
            error={revoke.error ? t("revokeError") : undefined}
          />
        ) : null,
    }),
  ])
  const error = listing.error ?? access.error
  return (
    <AdminPage
      title={t("title")}
      description={t("description")}
      actions={
        canManage ? (
          <Button
            onClick={() => {
              create.reset()
              form.reset()
              setCopy(undefined)
              setCreateOpen(true)
            }}
          >
            <PlusIcon aria-hidden="true" />
            {t("create")}
          </Button>
        ) : undefined
      }
    >
      <div className="flex gap-3 rounded-xl border bg-muted/30 p-4">
        <KeyRoundIcon
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">{t("usageTitle")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("usageDescription")}
          </p>
          <code
            dir="ltr"
            className="block w-fit max-w-full rounded-md border bg-background px-2.5 py-1.5 text-xs wrap-anywhere"
          >
            {t("headerExample")}
          </code>
        </div>
      </div>
      {!access.isPending && !access.error && !canManage && (
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      )}
      <DataTable
        columns={columns}
        data={listing.data?.data.items ?? []}
        getRowId={(row) => row.id}
        status={
          error
            ? "error"
            : listing.isPending || access.isPending
              ? "loading"
              : listing.isFetching
                ? "refreshing"
                : "ready"
        }
        error={t("loadError")}
        onRetry={() => {
          void listing.refetch()
          void access.refetch()
        }}
        showSearch={false}
        manualPagination
        rowCount={listing.data?.data.total ?? 0}
        state={{ pagination }}
        onPaginationChange={setPagination}
        enableSorting={false}
        enableHiding={false}
        enableRowSelection={false}
        empty={<p className="p-6 text-muted-foreground">{t("empty")}</p>}
      />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            title={t("create")}
            description={t("createDescription")}
            onSubmit={() => {
              void form.handleSubmit()
            }}
            pending={pending}
            submitLabel={t("create")}
            submitDisabled={!canManage}
            error={
              create.error
                ? create.error instanceof ApiClientError &&
                  create.error.status === 403
                  ? t("common:permissionDenied")
                  : t("createError")
                : undefined
            }
          >
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${id}-name`}>
                        {t("name")}
                      </FieldLabel>
                      <Input
                        id={`${id}-name`}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        maxLength={64}
                        required
                        autoComplete="off"
                        aria-invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="expiry">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${id}-expiry`}>
                        {t("expiresAt")}
                      </FieldLabel>
                      <Input
                        id={`${id}-expiry`}
                        type="datetime-local"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        required
                        aria-invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="selected" mode="array">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel>{t("permissions")}</FieldLabel>
                      <FieldDescription>
                        {t("permissionsHint")}
                      </FieldDescription>
                      <div className="space-y-4">
                        {Object.entries(permissionGroups).map(
                          ([resource, permissions]) => (
                            <FieldSet
                              key={resource}
                              className="rounded-lg border p-3"
                            >
                              <FieldLegend variant="label" className="px-1">
                                {resourceLabels[resource]}
                              </FieldLegend>
                              <FieldGroup data-slot="checkbox-group">
                                {permissions.map(({ action }) => {
                                  const value = `${resource}:${action}`
                                  return (
                                    <Field key={value} orientation="horizontal">
                                      <Checkbox
                                        id={`${id}-${value}`}
                                        checked={field.state.value.includes(
                                          value
                                        )}
                                        onCheckedChange={(checked) => {
                                          if (checked) field.pushValue(value)
                                          else
                                            field.removeValue(
                                              field.state.value.indexOf(value)
                                            )
                                        }}
                                        onBlur={field.handleBlur}
                                        aria-invalid={invalid}
                                      />
                                      <FieldLabel htmlFor={`${id}-${value}`}>
                                        {permissionLabel(resource, action)}
                                      </FieldLabel>
                                    </Field>
                                  )
                                })}
                              </FieldGroup>
                            </FieldSet>
                          )
                        )}
                      </div>
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
      <Dialog
        open={secret !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setSecret(undefined)
            setCopy(undefined)
            create.reset()
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("oneTimeTitle")}</DialogTitle>
            <DialogDescription>{t("oneTimeDescription")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-key`}>{t("key")}</FieldLabel>
            <Input
              id={`${id}-key`}
              value={secret ?? ""}
              readOnly
              autoComplete="off"
              dir="ltr"
              className="font-mono"
            />
          </Field>
          {copy === "copied" && <p role="status">{t("copied")}</p>}
          {copy === "failed" && (
            <p role="alert" className="text-sm text-destructive">
              {t("copyFailed")}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCopy(undefined)
                if (secret)
                  void navigator.clipboard
                    .writeText(secret)
                    .then(() => setCopy("copied"))
                    .catch(() => setCopy("failed"))
              }}
            >
              {t("copyKey")}
            </Button>
            <Button
              onClick={() => {
                setSecret(undefined)
                setCopy(undefined)
                create.reset()
              }}
            >
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
