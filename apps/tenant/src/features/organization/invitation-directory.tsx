import { getInvitationPageOptions } from "@/features/organization/organization-directories"
import {
  getInvitationDirectoryOptions,
  invitationDirectoryKey,
  MemberDirectoryError,
  type InvitationRow,
} from "@/features/organization/organization-directory"
import { getOrganizationRolesOptions } from "@/features/organization/organization-roles"
import { authClient } from "@/lib/auth-client"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ConfirmDangerAction, FormDialog } from "@workspace/admin"
import { authErrorMessage } from "@workspace/admin/auth"
import {
  createDataTableColumnHelper,
  DataTable,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { ApiClientError } from "@workspace/api-client"
import { OrganizationInvitationDirectoryQuerySchema } from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { BulkInvitationAction } from "./bulk-invitation-action"

const invitationColumns = createDataTableColumnHelper<InvitationRow>()
const EMPTY_INVITATIONS: InvitationRow[] = []

type InvitationActions = {
  actorRole: string
  canCreate: boolean
  canCancel: boolean
  resendPending: boolean
  cancelPending: boolean
  cancelError?: string
  resend: (invitation: InvitationRow, trigger: HTMLButtonElement) => void
  cancel: (id: string) => Promise<unknown>
  resetCancel: () => void
  cancelFinalFocus: () => HTMLElement | null
  canceledInvitationId: string | null
}
const InvitationActionsContext = createContext<InvitationActions | null>(null)

function InvitationActionsCell({ invitation }: { invitation: InvitationRow }) {
  const actions = useContext(InvitationActionsContext)!
  const cancelTrigger = useRef<HTMLElement | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const { t } = useTranslation(["organization", "common"])
  async function submitCancellation() {
    try {
      await actions.cancel(invitation.id)
    } catch {
      return
    }
    setCancelOpen(false)
  }
  if (invitation.role === "admin" && actions.actorRole !== "owner") return null
  return (
    // 成功取消后仅隐藏按钮，确认层仍完成关闭动画与最终焦点恢复。
    <div
      className={
        invitation.businessStatus === "pending"
          ? "flex flex-wrap gap-1"
          : "hidden"
      }
    >
      {actions.canCreate && (
        <Button
          size="xs"
          variant="ghost"
          disabled={actions.resendPending}
          onClick={(event) => actions.resend(invitation, event.currentTarget)}
        >
          {t("organization:resend")}
        </Button>
      )}
      {actions.canCancel && (
        <ConfirmDangerAction
          open={cancelOpen}
          triggerLabel={t("organization:cancelInvitation")}
          title={t("organization:cancelInvitationTitle")}
          description={t("organization:cancelInvitationDescription", {
            email: invitation.email,
          })}
          cancelLabel={t("common:cancel")}
          confirmLabel={t("organization:cancelInvitation")}
          pendingLabel={t("organization:cancelling")}
          pending={actions.cancelPending}
          error={actions.cancelError}
          finalFocus={() =>
            invitation.businessStatus === "pending" &&
            actions.canceledInvitationId !== invitation.id &&
            cancelTrigger.current?.isConnected
              ? cancelTrigger.current
              : actions.cancelFinalFocus()
          }
          onOpenChange={(open) => {
            setCancelOpen(open)
            if (open) {
              cancelTrigger.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null
              actions.resetCancel()
            }
          }}
          onConfirm={() => void submitCancellation()}
        />
      )}
    </div>
  )
}

function invitationSchema(emailMessage: string, roleMessage: string) {
  return z.object({
    email: z.email(emailMessage),
    role: z.string().min(1, roleMessage),
  })
}

export function InvitationDirectory({
  organizationId,
  actorRole,
}: {
  organizationId: string
  actorRole: string
}) {
  const { t } = useTranslation(["organization", "common", "auth", "validation"])
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const directoryTitle = useRef<HTMLHeadingElement>(null)
  const resendTrigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(() =>
    OrganizationInvitationDirectoryQuerySchema.parse({})
  )
  const [notice, setNotice] = useState<{
    resend: boolean
    delivery: InvitationRow["delivery"]
  }>()
  const access = useQuery({
    queryKey: [...invitationDirectoryKey(organizationId), "access"],
    queryFn: async () => {
      const check = async (action: "create" | "cancel") => {
        const result = await authClient.organization.hasPermission({
          organizationId,
          permissions: { invitation: [action] },
        })
        if (result.error)
          throw new Error(
            authErrorMessage(result.error, t("common:operationFailed"))
          )
        return result.data.success
      }
      const [create, cancel] = await Promise.all([
        check("create"),
        check("cancel"),
      ])
      return { create, cancel }
    },
    retry: false,
  })
  const canRead = Boolean(access.data?.create || access.data?.cancel)
  const invitations = useQuery({
    ...getInvitationPageOptions(organizationId, search),
    enabled: canRead,
    retry: false,
  })
  const canListRoles = actorRole === "owner" || actorRole === "admin"
  const roles = useQuery({
    ...getOrganizationRolesOptions(organizationId),
    enabled: Boolean(access.data?.create) && canListRoles,
  })
  useEffect(() => {
    if (
      (invitations.error instanceof MemberDirectoryError ||
        invitations.error instanceof ApiClientError) &&
      invitations.error.status === 403
    ) {
      queryClient.removeQueries({
        queryKey: invitationDirectoryKey(organizationId),
        predicate: (query) => query.queryKey.at(-1) !== "access",
      })
      void queryClient.invalidateQueries({
        queryKey: [...invitationDirectoryKey(organizationId), "access"],
      })
    }
  }, [invitations.error, organizationId, queryClient])
  const statusLabels = useMemo(
    () => ({
      pending: t("organization:invitation_pending"),
      accepted: t("organization:invitation_accepted"),
      rejected: t("organization:invitation_rejected"),
      canceled: t("organization:invitation_canceled"),
      expired: t("organization:invitation_expired"),
    }),
    [t]
  )
  const deliveryLabels = useMemo(
    () => ({
      pending: t("organization:delivery_pending"),
      smtp_accepted: t("organization:delivery_smtp_accepted"),
      failed: t("organization:delivery_failed"),
      unknown: t("organization:delivery_unknown"),
    }),
    [t]
  )
  async function refresh(id?: string, resend = false) {
    // 原生写已经提交；后续读取失败只影响结果展示，不能把创建成功变成表单提交失败。
    if (id) setNotice({ resend, delivery: null })
    try {
      const rows = await queryClient.query({
        ...getInvitationDirectoryOptions(organizationId),
        staleTime: 0,
      })
      if (id)
        setNotice({
          resend,
          delivery: rows.find((row) => row.id === id)?.delivery ?? null,
        })
    } catch {
      // 查询状态保存读取错误，由列表的 alert 展示；创建结果仍保持成功。
    }
    await queryClient.invalidateQueries({
      queryKey: invitationDirectoryKey(organizationId),
    })
    void queryClient.invalidateQueries({
      queryKey: ["organizations", organizationId, "access"],
    })
  }
  const send = useMutation({
    mutationFn: async (input: {
      email: string
      role: string
      resend?: boolean
    }) => {
      const result = await authClient.organization.inviteMember({
        ...input,
        organizationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
      return result.data.id
    },
    onSuccess: (id, input) => refresh(id, Boolean(input.resend)),
  })
  useEffect(() => {
    if (send.isPending || !resendTrigger.current) return
    const trigger = resendTrigger.current
    resendTrigger.current = null
    // 禁用会使浏览器失去按钮焦点；用户已经转到其他控件时不抢回焦点。
    if (document.activeElement === document.body) trigger.focus()
  }, [send.isPending, send.status])
  const cancel = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => refresh(),
  })
  const form = useForm({
    defaultValues: { email: "", role: "member" },
    validators: {
      onSubmit: invitationSchema(
        t("validation:email"),
        t("organization:roleRequired")
      ),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await send.mutateAsync({ email: value.email, role: value.role })
      } catch {
        // mutation 保存服务端错误供表单展示；失败提交在此结束，保留原草稿。
        return
      }
      formApi.reset()
      setOpen(false)
    },
  })
  const roleOptions = [
    "member",
    ...(actorRole === "owner" ? ["admin"] : []),
    ...(roles.data ?? []).map((role) => role.role),
  ]
  const roleLabel = useCallback(
    (role: string) =>
      role === "member"
        ? t("organization:role_member")
        : role === "admin"
          ? t("organization:role_admin")
          : role,
    [t]
  )
  // 列渲染器保持身份稳定，投递状态变化不能卸载确认弹层或替换聚焦中的按钮。
  const columns = useMemo(
    () =>
      invitationColumns.columns([
        invitationColumns.accessor("email", {
          header: t("organization:invitationEmail"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <bdi className="font-medium wrap-anywhere">{getValue()}</bdi>
          ),
          size: 260,
          meta: { label: t("organization:invitationEmail") },
        }),
        invitationColumns.accessor("role", {
          header: t("organization:role"),
          enableSorting: false,
          cell: ({ getValue }) => roleLabel(getValue()),
          size: 160,
          meta: { label: t("organization:role") },
        }),
        invitationColumns.accessor("businessStatus", {
          header: t("organization:invitationStatus"),
          enableSorting: false,
          cell: ({ getValue }) => statusLabels[getValue()],
          size: 150,
          meta: {
            label: t("organization:invitationStatus"),
            facetMode: "single",
            facetOptions: Object.entries(statusLabels).map(
              ([value, label]) => ({ value, label })
            ),
          },
        }),
        invitationColumns.accessor("inviterName", {
          header: t("organization:inviter"),
          enableSorting: false,
          size: 180,
          meta: { label: t("organization:inviter") },
        }),
        invitationColumns.accessor("createdAt", {
          header: t("organization:invitationCreatedAt"),
          cell: ({ getValue }) => (
            <time dateTime={new Date(getValue()).toISOString()}>
              {createFormatter(locale).dateTime(new Date(getValue()), "UTC")}
            </time>
          ),
          size: 220,
          meta: { label: t("organization:invitationCreatedAt") },
        }),
        invitationColumns.accessor("expiresAt", {
          header: t("organization:invitationExpiresAt"),
          cell: ({ getValue }) => (
            <time dateTime={new Date(getValue()).toISOString()}>
              {createFormatter(locale).dateTime(new Date(getValue()), "UTC")}
            </time>
          ),
          size: 220,
          meta: { label: t("organization:invitationExpiresAt") },
        }),
        invitationColumns.accessor("delivery", {
          header: t("organization:deliveryStatus"),
          enableSorting: false,
          cell: ({ getValue }) => {
            const delivery = getValue()
            return delivery
              ? deliveryLabels[delivery.status]
              : t("organization:delivery_unrecorded")
          },
          size: 210,
          meta: { label: t("organization:deliveryStatus") },
        }),
        invitationColumns.display({
          id: "actions",
          header: t("organization:directoryActions"),
          cell: ({ row }) => (
            <InvitationActionsCell invitation={row.original} />
          ),
          size: 220,
        }),
      ]),
    [locale, t, statusLabels, deliveryLabels, roleLabel]
  )
  if (access.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("common:loading")}
      </p>
    )
  if (access.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {access.error.message}
      </p>
    )
  if (!canRead) return null
  return (
    <section
      className="min-w-0 space-y-4 border-t pt-6"
      aria-labelledby="invitation-directory-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          ref={directoryTitle}
          id="invitation-directory-title"
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          {t("organization:invitations")}
        </h2>
      </div>
      {notice !== undefined && (
        <p
          role={
            notice.delivery?.status === "failed" ||
            notice.delivery?.status === "unknown"
              ? "alert"
              : "status"
          }
        >
          {notice.resend
            ? t("organization:invitationResent")
            : t("organization:invitationCreated")}{" "}
          {notice.delivery
            ? deliveryLabels[notice.delivery.status]
            : t("organization:delivery_unrecorded")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("organization:smtpAcceptanceNotice")}
      </p>
      {send.error && !open && (
        <p role="alert" className="text-sm text-destructive">
          {send.error.message}
        </p>
      )}
      <InvitationActionsContext
        value={{
          actorRole,
          canCreate: Boolean(access.data?.create),
          canCancel: Boolean(access.data?.cancel),
          resendPending: send.isPending,
          cancelPending: cancel.isPending,
          cancelError: cancel.error?.message,
          resend: (invitation, trigger) => {
            resendTrigger.current = trigger
            send.mutate({
              email: invitation.email,
              role: invitation.role,
              resend: true,
            })
          },
          cancel: (id) => cancel.mutateAsync(id),
          resetCancel: cancel.reset,
          cancelFinalFocus: () => directoryTitle.current,
          canceledInvitationId: cancel.isSuccess ? cancel.variables : null,
        }}
      >
        <DataTable
          paginationLabel={`${t("organization:invitations")} ${t("common:pagination")}`}
          toolbarActions={
            access.data?.create && (
              <>
                <BulkInvitationAction
                  organizationId={organizationId}
                  roleOptions={roleOptions}
                  canListRoles={canListRoles}
                  roleLabel={roleLabel}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    send.reset()
                    setOpen(true)
                  }}
                >
                  {t("organization:invite")}
                </Button>
              </>
            )
          }
          empty={<p>{t("organization:noInvitations")}</p>}
          columns={columns}
          data={invitations.data?.items ?? EMPTY_INVITATIONS}
          getRowId={(row) => row.id}
          rowCount={invitations.data?.total ?? 0}
          status={getDataTableQueryStatus(invitations)}
          error={invitations.error?.message}
          onRetry={() => void invitations.refetch()}
          manualPagination
          manualFiltering
          manualSorting
          enableRowSelection={false}
          enableMultiSort={false}
          searchPlaceholder={t("organization:searchInvitations")}
          searchMaxLength={120}
          state={{
            pagination: {
              pageIndex: search.page - 1,
              pageSize: search.pageSize,
            },
            sorting: [{ id: search.sortBy, desc: search.sortOrder === "desc" }],
            globalFilter: search.q ?? "",
            columnFilters: search.status
              ? [{ id: "businessStatus", value: search.status }]
              : [],
          }}
          onGlobalFilterChange={(updater) => {
            const q =
              typeof updater === "function" ? updater(search.q ?? "") : updater
            setSearch((current) => ({ ...current, page: 1, q: q || undefined }))
          }}
          onColumnFiltersChange={(updater) => {
            const current = search.status
              ? [{ id: "businessStatus", value: search.status }]
              : []
            const next =
              typeof updater === "function" ? updater(current) : updater
            setSearch((current) =>
              OrganizationInvitationDirectoryQuerySchema.parse({
                ...current,
                page: 1,
                status: next.find((filter) => filter.id === "businessStatus")
                  ?.value,
              })
            )
          }}
          onSortingChange={(updater) => {
            const sorting = [
              { id: search.sortBy, desc: search.sortOrder === "desc" },
            ]
            const next = (
              typeof updater === "function" ? updater(sorting) : updater
            )[0]
            setSearch((current) => ({
              ...current,
              page: 1,
              sortBy: next?.id === "expiresAt" ? "expiresAt" : "createdAt",
              sortOrder: next?.desc ? "desc" : "asc",
            }))
          }}
          onPaginationChange={(updater) => {
            const pagination = {
              pageIndex: search.page - 1,
              pageSize: search.pageSize,
            }
            const next =
              typeof updater === "function" ? updater(pagination) : updater
            setSearch((current) => ({
              ...current,
              page: next.pageIndex + 1,
              pageSize: next.pageSize,
            }))
          }}
          onResetFilters={() =>
            setSearch((current) => ({
              ...current,
              page: 1,
              q: undefined,
              status: undefined,
            }))
          }
        />
      </InvitationActionsContext>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <FormDialog
            open={open}
            onOpenChange={setOpen}
            title={t("organization:invite")}
            description={t("organization:inviteDescription")}
            onSubmit={() => void form.handleSubmit()}
            pending={send.isPending || submitting}
            error={send.error?.message}
            submitLabel={t("organization:inviteSubmit")}
          >
            <FieldGroup>
              <form.Field name="email">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="invite-email">
                        {t("auth:email")}
                      </FieldLabel>
                      <Input
                        id="invite-email"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        type="email"
                        autoComplete="email"
                        dir="ltr"
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
              <form.Field name="role">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="invite-role">
                        {t("organization:role")}
                      </FieldLabel>
                      {canListRoles ? (
                        <Select
                          value={field.state.value}
                          items={Object.fromEntries(
                            roleOptions.map((role) => [role, roleLabel(role)])
                          )}
                          onValueChange={(value) => {
                            if (value !== null) field.handleChange(value)
                          }}
                        >
                          <SelectTrigger
                            id="invite-role"
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {roleLabel(role)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id="invite-role"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          onBlur={field.handleBlur}
                          required
                          aria-invalid={invalid}
                        />
                      )}
                      {canListRoles && roles.isPending && (
                        <p
                          role="status"
                          className="text-sm text-muted-foreground"
                        >
                          {t("common:loading")}
                        </p>
                      )}
                      {canListRoles && roles.error && (
                        <p role="alert" className="text-sm text-destructive">
                          {roles.error.message}
                        </p>
                      )}
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
    </section>
  )
}
