import { useState } from "react"
import { useParams } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { ConfirmDangerAction, FormDialog, PageHeader } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { getOrganizationAccessOptions } from "@workspace/api-client"
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
import { getOrganizationDirectoryOptions } from "@/query/organization-directory"

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
  const { t } = useTranslation(["organization", "common", "validation", "auth"])
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const directoryOptions = getOrganizationDirectoryOptions(organizationId)
  const access = useQuery(getOrganizationAccessOptions(organizationId))
  const directory = useQuery(directoryOptions)
  const actor = directory.data?.members.find(
    (member) => member.userId === session.user.id
  )
  const actorRole = actor?.role ?? ""
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
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: directoryOptions.queryKey }),
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
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: directoryOptions.queryKey }),
  })
  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId,
      })
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: directoryOptions.queryKey }),
  })
  const resendInvitation = useMutation({
    mutationFn: async (input: { email: string; role: string }) => {
      const result = await authClient.organization.inviteMember({
        email: input.email,
        role: input.role,
        organizationId,
        resend: true,
      })
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: directoryOptions.queryKey }),
  })
  const cancelInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      })
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: directoryOptions.queryKey }),
  })

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
      {directory.isPending && <p role="status">{t("common:loading")}</p>}
      {directory.error && (
        <p role="alert" className="text-sm text-destructive">
          {directory.error.message}
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
                        description={t("organization:removeMemberDescription", {
                          name: member.user.name,
                        })}
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
            })}
          </ul>
          {updateRole.error && (
            <p role="alert" className="text-sm text-destructive">
              {updateRole.error.message}
            </p>
          )}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              {t("organization:pendingInvitations")}
            </h2>
            {directory.data.invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("organization:noPendingInvitations")}
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
