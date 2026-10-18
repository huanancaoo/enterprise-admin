import { TenantExportButton } from "../features/tasks/tenant-export-button"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { PageHeader, PersonalAvatar } from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  getOrganizationAccessOptions,
  organizationKeys,
} from "@workspace/api-client"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "@/lib/auth-client"
import {
  getMemberDirectoryOptions,
  getMemberActionPermissionsOptions,
  MemberDirectoryError,
  type MemberRow,
} from "@/query/organization-directory"
import { InvitationDirectory } from "./invitation-directory"
import { MemberActionDialog, type MemberAction } from "./member-action-dialog"

const membersPath = "/app/members/$organizationId"
const memberColumns = createDataTableColumnHelper<MemberRow>()
const EMPTY_MEMBERS: MemberRow[] = []

export function MembersRoute() {
  const { organizationId } = useParams({ from: membersPath })
  const search = useSearch({ from: membersPath })
  const navigate = useNavigate({ from: membersPath })
  const { t } = useTranslation(["organization", "common", "validation", "auth"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null)
  const directoryTitle = useRef<HTMLDivElement>(null)
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
    // 撤回读权限后清除所有分页缓存，不能在切换筛选时重新显示旧成员。
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
  const roleLabel = useCallback(
    (role: string) => {
      return role === "owner" || role === "admin" || role === "member"
        ? t(`organization:role_${role}`)
        : role
    },
    [t]
  )
  const columns = useMemo(
    () =>
      memberColumns.columns([
        memberColumns.accessor((row) => row.user.name, {
          id: "name",
          header: t("organization:memberAccount"),
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex min-w-0 items-center gap-3">
              <PersonalAvatar
                image={row.original.user.image}
                name={row.original.user.name}
                organizationId={
                  row.original.userId === session.user.id
                    ? undefined
                    : organizationId
                }
              />
              <div className="min-w-0">
                <p className="font-medium wrap-anywhere">
                  {row.original.user.name}
                  {row.original.userId === session.user.id && (
                    <Badge variant="secondary" className="ms-2">
                      {t("organization:currentUser")}
                    </Badge>
                  )}
                </p>
                <p
                  dir="ltr"
                  className="text-xs wrap-anywhere text-muted-foreground"
                >
                  {row.original.user.email}
                </p>
              </div>
            </div>
          ),
          size: 320,
          meta: { label: t("organization:memberAccount") },
        }),
        memberColumns.accessor("role", {
          header: t("organization:role"),
          cell: ({ getValue }) => (
            <Badge variant="outline">{roleLabel(getValue())}</Badge>
          ),
          size: 180,
          meta: {
            label: t("organization:role"),
            facetMode: "single",
            facetOptions: [
              ...new Set([
                "owner",
                "admin",
                "member",
                ...(search.role ? [search.role] : []),
              ]),
            ].map((value) => ({ value, label: roleLabel(value) })),
          },
        }),
        memberColumns.accessor("createdAt", {
          header: t("organization:joinedAt"),
          cell: ({ getValue }) => (
            <time dateTime={new Date(getValue()).toISOString()}>
              {createFormatter(locale).dateTime(new Date(getValue()), "UTC")}
            </time>
          ),
          size: 220,
          meta: { label: t("organization:joinedAt") },
        }),
        memberColumns.display({
          id: "actions",
          header: t("organization:directoryActions"),
          enableSorting: false,
          cell: ({ row }) => {
            const member = row.original
            const self = member.userId === session.user.id
            // 委派动作不包含管理 owner/admin 身份的资格。
            const manageable =
              Boolean(actorRole) &&
              (actorRole === "owner" ||
                (member.role !== "owner" && member.role !== "admin"))
            return (
              <div className="flex flex-wrap gap-1">
                {manageable && memberPermissions.data?.update && (
                  <Button
                    size="xs"
                    variant="ghost"
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
                {manageable && memberPermissions.data?.remove && !self && (
                  <Button
                    size="xs"
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
            )
          },
          size: 220,
        }),
      ]),
    [
      t,
      locale,
      session.user.id,
      organizationId,
      actorRole,
      memberPermissions.data,
      access.data,
      search.role,
      roleLabel,
    ]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  const columnFilters = search.role ? [{ id: "role", value: search.role }] : []
  return (
    <section className="min-w-0 space-y-6">
      <div ref={directoryTitle} tabIndex={-1}>
        <PageHeader
          title={t("organization:members")}
          description={t("organization:membersDescription")}
        />
      </div>
      {memberPermissions.error && (
        <p role="alert" className="text-sm text-destructive">
          {memberPermissions.error.message}
        </p>
      )}
      <DataTable
        paginationLabel={`${t("organization:members")} ${t("common:pagination")}`}
        empty={<p>{t("organization:noMembers")}</p>}
        columns={columns}
        data={
          directoryForbidden
            ? EMPTY_MEMBERS
            : (members.data?.members ?? EMPTY_MEMBERS)
        }
        getRowId={(row) => row.id}
        rowCount={directoryForbidden ? 0 : (members.data?.total ?? 0)}
        status={
          directoryForbidden ? "forbidden" : getDataTableQueryStatus(members)
        }
        error={members.error?.message}
        onRetry={() => void members.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableRowSelection={false}
        enableMultiSort={false}
        searchPlaceholder={t("organization:searchMembers")}
        searchMaxLength={120}
        state={{
          pagination,
          sorting,
          columnFilters,
          globalFilter: search.q ?? "",
        }}
        toolbarContent={
          <>
            <TenantExportButton
              organizationId={organizationId}
              resource="member"
              filters={search}
            />
            <Button
              size="sm"
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
          </>
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, page: 1, q: q || undefined } })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const role = next.find((filter) => filter.id === "role")?.value
          void navigate({
            search: {
              ...search,
              page: 1,
              role: typeof role === "string" ? role : undefined,
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
              sortBy: next?.id === "role" ? "role" : "createdAt",
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
            search: { ...search, page: 1, q: undefined, role: undefined },
          })
        }
      />
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
          successFocus={directoryTitle}
          onClose={() =>
            setMemberAction((current) =>
              current === memberAction ? null : current
            )
          }
        />
      )}
      <InvitationDirectory
        key={organizationId}
        organizationId={organizationId}
        actorRole={actorRole}
      />
    </section>
  )
}
