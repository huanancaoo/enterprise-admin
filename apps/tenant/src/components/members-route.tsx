import { PersonalAvatar } from "@workspace/admin"
import { useEffect, useRef, useState, type RefObject } from "react"
import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { PageHeader } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  getOrganizationAccessOptions,
  organizationKeys,
} from "@workspace/api-client"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
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
  getMemberDirectoryOptions,
  getMemberActionPermissionsOptions,
  MemberDirectoryError,
  type MemberDirectorySearch,
} from "@/query/organization-directory"

import { InvitationDirectory } from "./invitation-directory"

import { MemberActionDialog, type MemberAction } from "./member-action-dialog"

const membersPath = "/app/members/$organizationId"

function roleLabel(
  role: string,
  t: TFunction<["organization", "common", "validation", "auth"]>
) {
  if (role === "owner") return t("organization:role_owner")
  if (role === "admin") return t("organization:role_admin")
  if (role === "member") return t("organization:role_member")
  return role
}

export function MembersRoute() {
  const { organizationId } = useParams({ from: membersPath })
  const search = useSearch({ from: membersPath })
  const navigate = useNavigate({ from: membersPath })
  const { t } = useTranslation(["organization", "common", "validation", "auth"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null)
  const directorySearchRef = useRef<HTMLInputElement>(null)
  const members = useQuery(getMemberDirectoryOptions(organizationId, search))
  const memberPermissions = useQuery(
    getMemberActionPermissionsOptions(organizationId)
  )
  const directoryForbidden =
    members.error instanceof MemberDirectoryError &&
    members.error.status === 403
  useEffect(() => {
    if (!directoryForbidden) return
    const filters = {
      queryKey: [...organizationKeys.scope(organizationId), "members"],
    }
    // 读权限撤回会使所有筛选页失效；仅在仍有旧数据时重置，避免拒绝后反复请求。
    if (
      queryClient.getQueriesData(filters).some(([, data]) => data !== undefined)
    )
      void queryClient.resetQueries(filters)
  }, [directoryForbidden, organizationId, queryClient])
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
  function setSearch(
    updater: (current: MemberDirectorySearch) => MemberDirectorySearch
  ) {
    void navigate({ search: updater })
  }

  return (
    <section className="min-w-0 space-y-6">
      <PageHeader
        title={t("organization:members")}
        description={t("organization:membersDescription")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!access.data}
              onClick={(event) => {
                if (access.data)
                  setMemberAction({
                    kind: "leave",
                    trigger: event.currentTarget,
                    authorizationVersion: access.data.data.authorizationVersion,
                  })
              }}
            >
              {t("organization:leave")}
            </Button>
          </div>
        }
      />
      {members.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common:loading")}
        </p>
      )}
      {members.error && (
        <p role="alert" className="text-sm text-destructive">
          {members.error.message}
        </p>
      )}
      {memberPermissions.error && (
        <p role="alert" className="text-sm text-destructive">
          {memberPermissions.error.message}
        </p>
      )}
      {members.data && !directoryForbidden && (
        <>
          <MemberDirectoryControls
            key={JSON.stringify([organizationId, search])}
            search={search}
            onSearchChange={setSearch}
            inputRef={directorySearchRef}
          />
          <ul
            aria-label={t("organization:members")}
            className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm"
          >
            {members.data.members.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                {t("organization:noMembers")}
              </li>
            ) : (
              members.data.members.map((member) => {
                const self = member.userId === session.user.id
                // 动作权限可委派；管理 owner/admin 身份仍只属于 owner。
                const manageable =
                  Boolean(actorRole) &&
                  (actorRole === "owner" ||
                    (member.role !== "owner" && member.role !== "admin"))
                const canRemove =
                  manageable && Boolean(memberPermissions.data?.remove) && !self
                const canChangeRole =
                  manageable && Boolean(memberPermissions.data?.update)
                return (
                  <li
                    key={member.id}
                    className="flex flex-col items-start justify-between gap-4 px-4 py-4 sm:flex-row sm:px-5"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <PersonalAvatar
                        image={member.user.image}
                        name={member.user.name}
                        organizationId={self ? undefined : organizationId}
                      />
                      <div className="min-w-0">
                        <p className="font-medium wrap-anywhere">
                          {member.user.name}
                          {member.userId === session.user.id ? (
                            <Badge variant="secondary" className="ms-2">
                              {t("organization:currentUser")}
                            </Badge>
                          ) : null}
                        </p>
                        <p
                          dir="ltr"
                          className="text-sm wrap-anywhere text-muted-foreground"
                        >
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
                    <div className="flex w-full flex-wrap items-center gap-2 border-t pt-3 sm:w-auto sm:justify-end sm:border-0 sm:pt-0">
                      <p className="rounded-md bg-muted px-2 py-1 text-xs font-medium wrap-anywhere">
                        {roleLabel(member.role, t)}
                      </p>
                      {canChangeRole && (
                        <Button
                          variant="outline"
                          disabled={!access.data}
                          onClick={(event) => {
                            if (access.data)
                              setMemberAction({
                                kind: "role",
                                trigger: event.currentTarget,
                                member,
                                authorizationVersion:
                                  access.data.data.authorizationVersion,
                              })
                          }}
                        >
                          {t("organization:updateRole")}
                        </Button>
                      )}
                      {canRemove && (
                        <Button
                          variant="destructive"
                          disabled={!access.data}
                          onClick={(event) => {
                            if (access.data)
                              setMemberAction({
                                kind: "remove",
                                trigger: event.currentTarget,
                                member,
                                authorizationVersion:
                                  access.data.data.authorizationVersion,
                              })
                          }}
                        >
                          {t("organization:removeMember")}
                        </Button>
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
        </>
      )}
      {memberAction && (
        <MemberActionDialog
          key={
            memberAction.kind === "leave"
              ? "leave"
              : `${memberAction.kind}:${memberAction.member.id}`
          }
          organizationId={organizationId}
          actorRole={actorRole}
          action={memberAction}
          successFocus={directorySearchRef}
          onClose={() =>
            setMemberAction((current) =>
              current === memberAction ? null : current
            )
          }
        />
      )}
      <InvitationDirectory
        organizationId={organizationId}
        actorRole={actorRole}
      />
    </section>
  )
}

const memberDirectoryFormSchema = z.object({
  q: z.string(),
  role: z.string(),
  sortBy: z.enum(["createdAt", "role"]),
  sortOrder: z.enum(["asc", "desc"]),
})

function MemberDirectoryControls({
  search,
  onSearchChange,
  inputRef,
}: {
  search: MemberDirectorySearch
  inputRef: RefObject<HTMLInputElement | null>
  onSearchChange: (
    updater: (current: MemberDirectorySearch) => MemberDirectorySearch
  ) => void
}) {
  const { t } = useTranslation(["organization"])
  const customRole =
    search.role && !["owner", "admin", "member"].includes(search.role)
      ? search.role
      : undefined
  const form = useForm({
    defaultValues: {
      q: search.q ?? "",
      role: search.role ?? "",
      sortBy: search.sortBy,
      sortOrder: search.sortOrder,
    },
    validators: { onSubmit: memberDirectoryFormSchema },
    onSubmit: ({ value }) => {
      onSearchChange((current) => ({
        ...current,
        page: 1,
        q: value.q.trim() || undefined,
        role: value.role || undefined,
        sortBy: value.sortBy,
        sortOrder: value.sortOrder,
      }))
    },
  })
  return (
    <form
      className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FieldGroup
            className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
            aria-busy={pending}
          >
            <form.Field name="q">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-w-0" data-invalid={isInvalid}>
                    <FieldLabel htmlFor="member-search">
                      {t("organization:searchMembers")}
                    </FieldLabel>
                    <Input
                      ref={inputRef}
                      id="member-search"
                      name={field.name}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      type="search"
                      autoComplete="off"
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="role">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-w-0" data-invalid={isInvalid}>
                    <FieldLabel htmlFor="member-role">
                      {t("organization:role")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={{
                        "": t("organization:allRoles"),
                        owner: t("organization:role_owner"),
                        admin: t("organization:role_admin"),
                        member: t("organization:role_member"),
                        ...(customRole ? { [customRole]: customRole } : {}),
                      }}
                      onValueChange={(value) => {
                        if (typeof value === "string") field.handleChange(value)
                      }}
                    >
                      <SelectTrigger
                        id="member-role"
                        className="w-full"
                        aria-invalid={isInvalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">
                          {t("organization:allRoles")}
                        </SelectItem>
                        <SelectItem value="owner">
                          {t("organization:role_owner")}
                        </SelectItem>
                        <SelectItem value="admin">
                          {t("organization:role_admin")}
                        </SelectItem>
                        <SelectItem value="member">
                          {t("organization:role_member")}
                        </SelectItem>
                        {customRole && (
                          <SelectItem value={customRole}>
                            {customRole}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="sortBy">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-w-0" data-invalid={isInvalid}>
                    <FieldLabel htmlFor="member-sort-by">
                      {t("organization:sortBy")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={{
                        createdAt: t("organization:joinedAt"),
                        role: t("organization:role"),
                      }}
                      onValueChange={(value) => {
                        if (value !== "createdAt" && value !== "role") return
                        field.handleChange(value)
                      }}
                    >
                      <SelectTrigger
                        id="member-sort-by"
                        className="w-full"
                        aria-invalid={isInvalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="createdAt">
                          {t("organization:joinedAt")}
                        </SelectItem>
                        <SelectItem value="role">
                          {t("organization:role")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="sortOrder">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-w-0" data-invalid={isInvalid}>
                    <FieldLabel htmlFor="member-sort-order">
                      {t("organization:sortOrder")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={{
                        desc: t("organization:sortDesc"),
                        asc: t("organization:sortAsc"),
                      }}
                      onValueChange={(value) => {
                        if (value !== "asc" && value !== "desc") return
                        field.handleChange(value)
                      }}
                    >
                      <SelectTrigger
                        id="member-sort-order"
                        className="w-full"
                        aria-invalid={isInvalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">
                          {t("organization:sortDesc")}
                        </SelectItem>
                        <SelectItem value="asc">
                          {t("organization:sortAsc")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <Button type="submit" disabled={pending}>
              {t("organization:applyMemberFilters")}
            </Button>
          </FieldGroup>
        )}
      </form.Subscribe>
    </form>
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
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
      <Button
        type="button"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t("previous")}
      </Button>
      <span className="min-w-16 text-center tabular-nums">
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
