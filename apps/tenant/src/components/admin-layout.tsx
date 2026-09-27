import { useEffect, useState } from "react"
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AppShell } from "@workspace/admin"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { useUiLocale } from "@workspace/i18n/react"
import { FolderKanbanIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  getOrganizationAccessOptions,
  organizationKeys,
} from "@workspace/api-client"
import {
  useDropStaleOrganizationQueries,
  useOrganizationWorkspace,
} from "@/hooks/use-organization-workspace"
import { authClient } from "@/lib/auth-client"
import {
  CreateOrganizationDialog,
  OrganizationUnavailable,
} from "./organization-workspace"

export function AdminLayout() {
  const { t, i18n } = useTranslation([
    "organization",
    "projects",
    "settings",
    "common",
    "errors",
  ])
  const uiLocale = useUiLocale()
  const session = useAuthenticatedSession()!
  const workspace = useOrganizationWorkspace()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false })
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const organizationId = params.organizationId
  const activeOrganization = useQuery({
    queryKey: ["auth", "active-organization"],
    enabled: !organizationId,
    retry: false,
    queryFn: async () => {
      const result = await authClient.organization.getFullOrganization()
      if (result.error) throw new Error(result.error.message)
      return result.data?.id ?? null
    },
  })
  const currentOrganizationId = organizationId ?? activeOrganization.data
  const organizations = workspace.workspace.data ?? []
  const onMembers = pathname.startsWith("/app/members/")
  const onOrganizationSettings = pathname.endsWith("/settings")
  const onPersonalSettings = pathname === "/app/settings/preferences"
  useDropStaleOrganizationQueries(currentOrganizationId ?? undefined)
  const access = useQuery({
    ...getOrganizationAccessOptions(currentOrganizationId ?? ""),
    enabled: Boolean(currentOrganizationId),
  })
  const settingsPermission = useQuery({
    queryKey: [
      "organizations",
      currentOrganizationId,
      "tenant-settings-permission",
    ],
    enabled: Boolean(currentOrganizationId),
    retry: false,
    queryFn: async () => {
      const result = await authClient.organization.getActiveMemberRole({
        query: { organizationId: currentOrganizationId ?? "" },
      })
      if (result.error) throw new Error(result.error.message)
      return result.data.role
        .split(",")
        .some((role) => role === "owner" || role === "admin")
    },
  })
  useEffect(() => {
    const nextLocale = access.data?.data.effectiveLocale
    if (nextLocale && nextLocale !== uiLocale)
      void i18n.changeLanguage(nextLocale)
  }, [access.data?.data.effectiveLocale, i18n, uiLocale])
  useEffect(() => {
    if (
      !currentOrganizationId ||
      !(access.error instanceof ApiClientError) ||
      (access.error.body.code !== "ORGANIZATION_SUSPENDED" &&
        access.error.body.code !== "FORBIDDEN")
    )
      return
    // 保留访问拒绝本身，清掉该组织的业务数据，避免删除活跃 access 查询导致反复请求。
    const filters = {
      queryKey: organizationKeys.scope(currentOrganizationId),
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[2] !== "access",
    }
    void queryClient.cancelQueries(filters)
    queryClient.removeQueries(filters)
  }, [access.error, currentOrganizationId, queryClient])
  const projectListSearch =
    !onMembers &&
    (search.sortBy === "createdAt" || search.sortBy === "updatedAt")
      ? {
          page: search.page,
          pageSize: search.pageSize,
          status: search.status,
          name: search.name,
          sortBy: search.sortBy,
          sortOrder: search.sortOrder,
        }
      : {}
  const projectLink = currentOrganizationId ? (
    <Link
      to="/app/projects/$organizationId"
      params={{ organizationId: currentOrganizationId }}
      search={params.projectId ? {} : projectListSearch}
    />
  ) : undefined
  const membersLink = currentOrganizationId ? (
    <Link
      to="/app/members/$organizationId"
      params={{ organizationId: currentOrganizationId }}
    />
  ) : undefined
  const organizationSettingsLink = currentOrganizationId ? (
    <Link
      to="/app/organizations/$organizationId/settings"
      params={{ organizationId: currentOrganizationId }}
    />
  ) : undefined
  const suspended =
    access.error instanceof ApiClientError &&
    access.error.body.code === "ORGANIZATION_SUSPENDED"

  async function selectOrganization(nextOrganizationId: string) {
    const target = organizations.find((item) => item.id === nextOrganizationId)
    if (target?.status === "ACTIVE") {
      if (!(await workspace.selectOrganization(nextOrganizationId))) return
    }
    if (onMembers) {
      await navigate({
        to: "/app/members/$organizationId",
        params: { organizationId: nextOrganizationId },
      })
      return
    }
    if (onOrganizationSettings) {
      await navigate({
        to: "/app/organizations/$organizationId/settings",
        params: { organizationId: nextOrganizationId },
      })
      return
    }
    await navigate({
      to: "/app/projects/$organizationId",
      params: { organizationId: nextOrganizationId },
      search: params.projectId ? {} : { ...projectListSearch, page: 1 },
    })
  }

  return (
    <AppShell
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            {params.projectId && (
              <>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink render={projectLink}>
                    {t("projects:title")}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
              </>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage>
                {onMembers
                  ? t("organization:members")
                  : onOrganizationSettings
                    ? t("settings:organizationSettings")
                    : onPersonalSettings
                      ? t("settings:personalSettings")
                      : params.projectId
                        ? t("projects:detail")
                        : t("projects:title")}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      sidebar={{
        teamSwitcher: {
          teams: organizations.map((organization) => ({
            id: organization.id,
            name: organization.name,
          })),
          value: currentOrganizationId ?? null,
          label: t("organization:select"),
          disabled: workspace.pending,
          createLabel: t("organization:create"),
          onSelect: (id) => void selectOrganization(id),
          onCreate: () => setCreateOpen(true),
        },
        navigation: {
          label: t("common:navigation"),
          items: [
            {
              title: t("projects:title"),
              icon: <FolderKanbanIcon />,
              isActive: pathname.startsWith("/app/projects/"),
              disabled: !currentOrganizationId || suspended,
              render: projectLink,
            },
            {
              title: t("organization:members"),
              icon: <UsersIcon />,
              isActive: onMembers,
              disabled: !currentOrganizationId || suspended,
              render: membersLink,
            },
            ...(settingsPermission.data
              ? [
                  {
                    title: t("settings:organizationSettings"),
                    icon: <SettingsIcon />,
                    isActive: onOrganizationSettings,
                    disabled: !currentOrganizationId || suspended,
                    render: organizationSettingsLink,
                  },
                ]
              : []),
            {
              title: t("settings:personalSettings"),
              icon: <SettingsIcon />,
              isActive: pathname === "/app/settings/preferences",
              render: <Link to="/app/settings/preferences" />,
            },
          ],
        },
        user: {
          user: {
            name: session.user.name,
            email: session.user.email,
            avatar: session.user.image ?? undefined,
            lastLoginMethod: session.user.lastLoginMethod,
          },
          signingOut: session.signingOut,
          error: session.signOutError,
          onSignOut: session.signOut,
        },
      }}
    >
      {workspace.error && (
        <p role="alert" className="text-sm text-destructive">
          {workspace.error}
        </p>
      )}
      {currentOrganizationId && access.isPending && (
        <p role="status">{t("organization:loading")}</p>
      )}
      {suspended && (
        <OrganizationUnavailable
          organizations={organizations}
          currentId={currentOrganizationId ?? undefined}
        />
      )}
      {access.error && !suspended && (
        <p role="alert" className="text-sm text-destructive">
          {access.error.message}
        </p>
      )}
      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createOrganization={workspace.createOrganization}
        pending={workspace.pending}
        error={workspace.error}
        onCreated={(nextOrganizationId) => {
          void navigate({
            to: onMembers
              ? "/app/members/$organizationId"
              : onOrganizationSettings
                ? "/app/organizations/$organizationId/settings"
                : "/app/projects/$organizationId",
            params: { organizationId: nextOrganizationId },
          })
        }}
      />
      {!currentOrganizationId || access.isSuccess ? <Outlet /> : null}
    </AppShell>
  )
}
