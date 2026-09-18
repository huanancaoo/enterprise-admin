import { useState } from "react"
import { useParams } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { ConfirmDangerAction, FormDialog, PageHeader } from "@workspace/admin"
import { useAuthenticatedSession, useAuthAction } from "@workspace/admin/auth"
import { useGetOrganizationAccessQueryOptions } from "@workspace/api-client"
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

const membersPath = "/app/members/$organizationId"

type MemberRow = {
  id: string
  userId: string
  role: string
  user: { name: string; email: string }
}

type InvitationRow = {
  id: string
  email: string
  role: string
  status: string
}

function inviteSchema(
  t: TFunction<["organization", "common", "validation", "auth"]>
) {
  return z.object({
    email: z.email(t("validation:email")),
    role: z.enum(["member", "admin"]),
  })
}

function membersQueryKey(organizationId: string) {
  return ["organization-members", organizationId] as const
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

export function MembersRoute() {
  const { organizationId } = useParams({ from: membersPath })
  const { t } = useTranslation(["organization", "common", "validation", "auth"])
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const action = useAuthAction()
  const [inviteOpen, setInviteOpen] = useState(false)
  const access = useQuery(useGetOrganizationAccessQueryOptions(organizationId))
  const directory = useQuery({
    queryKey: membersQueryKey(organizationId),
    queryFn: async () => {
      const [members, invitations] = await Promise.all([
        authClient.organization.listMembers({
          query: { organizationId },
        }),
        authClient.organization.listInvitations({
          query: { organizationId },
        }),
      ])
      if (members.error) throw new Error(members.error.message)
      if (invitations.error) throw new Error(invitations.error.message)
      const memberRows = members.data.members as MemberRow[]
      const invitationRows = invitations.data as InvitationRow[]
      return {
        members: memberRows,
        invitations: invitationRows.filter(
          (invitation) => invitation.status === "pending"
        ),
      }
    },
    retry: false,
  })
  const actor = directory.data?.members.find(
    (member) => member.userId === session.user.id
  )
  const actorRole = actor?.role ?? ""
  const canInvite = actorRole === "owner" || actorRole === "admin"
  const canInviteAdmin = actorRole === "owner"
  const form = useForm({
    defaultValues: { email: "", role: "member" as "member" | "admin" },
    validators: { onSubmit: inviteSchema(t) },
    onSubmit: async ({ value, formApi }) => {
      const ok = await action.run(() =>
        authClient.organization.inviteMember({
          email: value.email.trim(),
          role: canInviteAdmin ? value.role : "member",
          organizationId,
        })
      )
      if (!ok) return
      formApi.reset()
      setInviteOpen(false)
      await queryClient.invalidateQueries({
        queryKey: membersQueryKey(organizationId),
      })
    },
  })

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: membersQueryKey(organizationId),
    })
  }

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
      {directory.isPending && <p role="status">{t("common:loading")}</p>}
      {directory.error && (
        <p role="alert" className="text-sm text-destructive">
          {directory.error.message}
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
      {directory.data && (
        <>
          <ul className="divide-y rounded-xl border">
            {directory.data.members.map((member) => {
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
                  <div className="min-w-0">
                    <p className="font-medium">{member.user.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {member.user.email}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canChangeRole ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => {
                          if (value !== "member" && value !== "admin") {
                            throw new Error(`unknown role: ${value}`)
                          }
                          void action.run(async () => {
                            const result =
                              await authClient.organization.updateMemberRole({
                                memberId: member.id,
                                role: value,
                                organizationId,
                                ...versionHeader,
                              })
                            if (!result.error) await refresh()
                            return result
                          })
                        }}
                      >
                        <SelectTrigger
                          aria-label={t("organization:updateRole")}
                          className="w-36"
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
                        description={t("organization:removeMemberDescription", {
                          name: member.user.name,
                        })}
                        cancelLabel={t("common:cancel")}
                        confirmLabel={t("organization:removeMember")}
                        pendingLabel={t("organization:removing")}
                        pending={action.pending}
                        error={action.error}
                        onConfirm={() => {
                          void action.run(async () => {
                            const result =
                              await authClient.organization.removeMember({
                                memberIdOrEmail: member.id,
                                organizationId,
                              })
                            if (!result.error) await refresh()
                            return result
                          })
                        }}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              {t("organization:pendingInvitations")}
            </h2>
            {directory.data.invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("common:emptyTitle")}
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {directory.data.invitations.map((invitation) => (
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
                          disabled={action.pending}
                          onClick={() => {
                            void action.run(async () => {
                              const result =
                                await authClient.organization.inviteMember({
                                  email: invitation.email,
                                  role: invitation.role,
                                  organizationId,
                                  resend: true,
                                })
                              if (!result.error) await refresh()
                              return result
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
                          pending={action.pending}
                          error={action.error}
                          onConfirm={() => {
                            void action.run(async () => {
                              const result =
                                await authClient.organization.cancelInvitation({
                                  invitationId: invitation.id,
                                })
                              if (!result.error) await refresh()
                              return result
                            })
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
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
            pending={action.pending || submitting}
            error={action.error}
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
                        onValueChange={(value) => {
                          if (value !== "member" && value !== "admin") {
                            throw new Error(`unknown role: ${value}`)
                          }
                          field.handleChange(value)
                        }}
                      >
                        <SelectTrigger id="invite-role">
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
