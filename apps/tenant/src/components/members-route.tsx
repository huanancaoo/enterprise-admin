import { useState } from "react"
import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { ConfirmDangerAction, FormDialog, PageHeader } from "@workspace/admin"
import {
  authErrorMessage,
  useAuthenticatedSession,
} from "@workspace/admin/auth"
import { getOrganizationAccessOptions } from "@workspace/api-client"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import * as z from "zod"
import { authClient } from "@/lib/auth-client"
import {
  getInvitationDirectoryOptions,
  getMemberDirectoryOptions,
  invitationDirectoryKey,
  memberDirectoryKey,
  type MemberDirectorySearch,
} from "@/query/organization-directory"

const membersPath = "/app/members/$organizationId"

function inviteSchema(
  t: TFunction<["organization", "common", "validation", "auth"]>
) {
  return z.object({
    email: z.email(t("validation:email")),
    role: z.enum(["member", "admin"]),
  })
}

function roleLabel(
  role: string,
  t: TFunction<["organization", "common", "validation", "auth"]>
) {
  if (role === "owner") return t("organization:role_owner")
  if (role === "admin") return t("organization:role_admin")
  if (role === "member") return t("organization:role_member")
  throw new Error(`unknown role: ${role}`)
}

function mutationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined
}

export function MembersRoute() {
  const { organizationId } = useParams({ from: membersPath })
  const search = useSearch({ from: membersPath })
  const navigate = useNavigate({ from: membersPath })
  const { t } = useTranslation(["organization", "common", "validation", "auth"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const members = useQuery(getMemberDirectoryOptions(organizationId, search))
  const invitations = useQuery(getInvitationDirectoryOptions(organizationId))
  const actorRoleQuery = useQuery({
    queryKey: ["organizations", organizationId, "active-member-role"],
    queryFn: async () => {
      const result = await authClient.organization.getActiveMemberRole({
        query: { organizationId },
      })
      if (result.error) throw new Error(result.error.message)
      return result.data.role
    },
  })
  const access = useQuery(getOrganizationAccessOptions(organizationId))
  const actorRole = actorRoleQuery.data ?? ""
  const canInvite = actorRole === "owner" || actorRole === "admin"
  const canInviteAdmin = actorRole === "owner"
  const versionHeader = access.data
    ? {
        fetchOptions: {
          headers: {
            "X-Expected-Authz-Version": String(
              access.data.data.authorizationVersion
            ),
          },
        },
      }
    : {}

  const invite = useMutation({
    mutationFn: async (input: { email: string; role: "member" | "admin" }) => {
      const result = await authClient.organization.inviteMember({
        email: input.email,
        role: input.role,
        organizationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => invalidateDirectory(),
  })
  const updateRole = useMutation({
    mutationFn: async (input: {
      memberId: string
      role: "member" | "admin"
    }) => {
      const result = await authClient.organization.updateMemberRole({
        memberId: input.memberId,
        role: input.role,
        organizationId,
        ...versionHeader,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => invalidateDirectory(),
  })
  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => invalidateDirectory(),
  })
  const resendInvitation = useMutation({
    mutationFn: async (input: { email: string; role: string }) => {
      const result = await authClient.organization.inviteMember({
        email: input.email,
        role: input.role,
        organizationId,
        resend: true,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => invalidateDirectory(),
  })
  const cancelInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => invalidateDirectory(),
  })

  function invalidateDirectory() {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: memberDirectoryKey(organizationId, search).slice(0, 3),
      }),
      queryClient.invalidateQueries({
        queryKey: invitationDirectoryKey(organizationId),
      }),
    ])
  }

  function setSearch(
    updater: (current: MemberDirectorySearch) => MemberDirectorySearch
  ) {
    void navigate({ search: updater })
  }

  const form = useForm({
    defaultValues: { email: "", role: "member" as "member" | "admin" },
    validators: { onSubmit: inviteSchema(t) },
    onSubmit: async ({ value, formApi }) => {
      await invite.mutateAsync({
        email: value.email.trim(),
        role: canInviteAdmin ? value.role : "member",
      })
      formApi.reset()
      setInviteOpen(false)
    },
  })

  return (
    <section className="space-y-8">
      <PageHeader
        title={t("organization:members")}
        description={t("organization:membersDescription")}
        actions={
          canInvite ? (
            <Button onClick={() => setInviteOpen(true)}>
              {t("organization:invite")}
            </Button>
          ) : null
        }
      />
      {members.isPending && <p role="status">{t("common:loading")}</p>}
      {members.error && (
        <p role="alert" className="text-sm text-destructive">
          {members.error.message}
        </p>
      )}
      {members.data && (
        <>
          <MemberDirectoryControls search={search} onSearchChange={setSearch} />
          <ul className="divide-y rounded-xl border">
            {members.data.members.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                {t("organization:noMembers")}
              </li>
            ) : (
              members.data.members.map((member) => {
                const canRemove =
                  member.role !== "owner" &&
                  (actorRole === "owner" ||
                    (actorRole === "admin" && member.role === "member"))
                const canChangeRole =
                  actorRole === "owner" && member.role !== "owner"
                return (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar>
                        {member.user.image ? (
                          <AvatarImage src={member.user.image} alt="" />
                        ) : null}
                        <AvatarFallback>
                          {member.user.name.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium">
                          {member.user.name}
                          {member.userId === session.user.id ? (
                            <Badge variant="secondary" className="ms-2">
                              {t("organization:currentUser")}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {member.user.email}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t("organization:joinedAt")}{" "}
                          <time
                            dateTime={new Date(member.createdAt).toISOString()}
                          >
                            {createFormatter(locale).dateTime(
                              new Date(member.createdAt),
                              "UTC"
                            )}
                          </time>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canChangeRole ? (
                        <Select
                          value={member.role}
                          items={{
                            member: t("organization:role_member"),
                            admin: t("organization:role_admin"),
                          }}
                          onValueChange={(value) => {
                            if (value !== "member" && value !== "admin") {
                              throw new Error(`unknown role: ${value}`)
                            }
                            updateRole.mutate({
                              memberId: member.id,
                              role: value,
                            })
                          }}
                        >
                          <SelectTrigger
                            aria-label={t("organization:updateRole")}
                            className="w-36"
                            disabled={updateRole.isPending}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">
                              {t("organization:role_member")}
                            </SelectItem>
                            <SelectItem value="admin">
                              {t("organization:role_admin")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm">{roleLabel(member.role, t)}</p>
                      )}
                      {canRemove && (
                        <ConfirmDangerAction
                          triggerLabel={t("organization:removeMember")}
                          title={t("organization:removeMemberTitle")}
                          description={t(
                            "organization:removeMemberDescription",
                            {
                              name: member.user.name,
                            }
                          )}
                          cancelLabel={t("common:cancel")}
                          confirmLabel={t("organization:removeMember")}
                          pendingLabel={t("organization:removing")}
                          pending={removeMember.isPending}
                          error={mutationErrorMessage(removeMember.error)}
                          onConfirm={() => {
                            removeMember.mutate(member.id)
                          }}
                        />
                      )}
                    </div>
                  </li>
                )
              })
            )}
          </ul>
          <MemberDirectoryPager
            page={search.page}
            pageSize={search.pageSize}
            total={members.data.total}
            onPageChange={(page) =>
              setSearch((current) => ({ ...current, page }))
            }
          />
          {updateRole.error && (
            <p role="alert" className="text-sm text-destructive">
              {updateRole.error.message}
            </p>
          )}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              {t("organization:pendingInvitations")}
            </h2>
            {(invitations.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("organization:noPendingInvitations")}
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {(invitations.data ?? []).map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {roleLabel(invitation.role, t)}
                      </p>
                    </div>
                    {canInvite && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={resendInvitation.isPending}
                          onClick={() => {
                            resendInvitation.mutate({
                              email: invitation.email,
                              role: invitation.role,
                            })
                          }}
                        >
                          {t("organization:resend")}
                        </Button>
                        <ConfirmDangerAction
                          triggerLabel={t("organization:cancelInvitation")}
                          title={t("organization:cancelInvitationTitle")}
                          description={t(
                            "organization:cancelInvitationDescription",
                            { email: invitation.email }
                          )}
                          cancelLabel={t("common:cancel")}
                          confirmLabel={t("organization:cancelInvitation")}
                          pendingLabel={t("organization:cancelling")}
                          pending={cancelInvitation.isPending}
                          error={mutationErrorMessage(cancelInvitation.error)}
                          onConfirm={() => {
                            cancelInvitation.mutate(invitation.id)
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {resendInvitation.error && (
              <p role="alert" className="text-sm text-destructive">
                {resendInvitation.error.message}
              </p>
            )}
          </section>
        </>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <FormDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            title={t("organization:invite")}
            description={t("organization:inviteDescription")}
            onSubmit={() => void form.handleSubmit()}
            pending={invite.isPending || submitting}
            error={mutationErrorMessage(invite.error)}
            submitLabel={t("organization:inviteSubmit")}
          >
            <FieldGroup>
              <form.Field name="email">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="invite-email">
                        {t("auth:email")}
                      </FieldLabel>
                      <Input
                        id="invite-email"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        type="email"
                        autoComplete="email"
                        aria-invalid={isInvalid}
                        required
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              {canInviteAdmin && (
                <form.Field name="role">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="invite-role">
                        {t("organization:role")}
                      </FieldLabel>
                      <Select
                        value={field.state.value}
                        items={{
                          member: t("organization:role_member"),
                          admin: t("organization:role_admin"),
                        }}
                        onValueChange={(value) => {
                          if (value !== "member" && value !== "admin") {
                            throw new Error(`unknown role: ${value}`)
                          }
                          field.handleChange(value)
                        }}
                      >
                        <SelectTrigger
                          id="invite-role"
                          onBlur={field.handleBlur}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">
                            {t("organization:role_member")}
                          </SelectItem>
                          <SelectItem value="admin">
                            {t("organization:role_admin")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
              )}
            </FieldGroup>
          </FormDialog>
        )}
      </form.Subscribe>
    </section>
  )
}

function MemberDirectoryControls({
  search,
  onSearchChange,
}: {
  search: MemberDirectorySearch
  onSearchChange: (
    updater: (current: MemberDirectorySearch) => MemberDirectorySearch
  ) => void
}) {
  const { t } = useTranslation(["organization", "common"])
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="min-w-56">
        <FieldLabel htmlFor="member-search">
          {t("organization:searchMembers")}
        </FieldLabel>
        <Input
          id="member-search"
          value={search.q ?? ""}
          onChange={(event) => {
            const q = event.target.value.trim()
            onSearchChange((current) => ({
              ...current,
              page: 1,
              q: q || undefined,
            }))
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="member-role">{t("organization:role")}</FieldLabel>
        <Select
          value={search.role ?? "all"}
          items={{
            all: t("organization:allRoles"),
            owner: t("organization:role_owner"),
            admin: t("organization:role_admin"),
            member: t("organization:role_member"),
          }}
          onValueChange={(value) =>
            onSearchChange((current) => ({
              ...current,
              page: 1,
              role: value === "all" ? undefined : value,
            }))
          }
        >
          <SelectTrigger id="member-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("organization:allRoles")}</SelectItem>
            <SelectItem value="owner">
              {t("organization:role_owner")}
            </SelectItem>
            <SelectItem value="admin">
              {t("organization:role_admin")}
            </SelectItem>
            <SelectItem value="member">
              {t("organization:role_member")}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="member-sort">
          {t("organization:joinedAt")}
        </FieldLabel>
        <Select
          value={`${search.sortBy}:${search.sortOrder}`}
          items={{
            "createdAt:desc": `${t("organization:joinedAt")} ↓`,
            "createdAt:asc": `${t("organization:joinedAt")} ↑`,
            "role:asc": `${t("organization:role")} ↑`,
            "role:desc": `${t("organization:role")} ↓`,
          }}
          onValueChange={(value) => {
            const [sortBy, sortOrder] = value.split(":")
            if (
              (sortBy !== "createdAt" && sortBy !== "role") ||
              (sortOrder !== "asc" && sortOrder !== "desc")
            )
              return
            onSearchChange((current) => ({
              ...current,
              page: 1,
              sortBy,
              sortOrder,
            }))
          }}
        >
          <SelectTrigger id="member-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt:desc">
              {t("organization:joinedAt")} ↓
            </SelectItem>
            <SelectItem value="createdAt:asc">
              {t("organization:joinedAt")} ↑
            </SelectItem>
            <SelectItem value="role:asc">{t("organization:role")} ↑</SelectItem>
            <SelectItem value="role:desc">
              {t("organization:role")} ↓
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

function MemberDirectoryPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation("common")
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t("previous")}
      </Button>
      <span>
        {page} / {pages}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        {t("next")}
      </Button>
    </div>
  )
}
