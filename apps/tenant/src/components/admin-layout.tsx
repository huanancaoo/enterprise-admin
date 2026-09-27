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
import {
  ClipboardListIcon,
  FolderKanbanIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
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
import { isOrganizationRolesPath } from "@/lib/organization-route"
import {
  cancelOrganizationSwitchLocale,
  preserveLocaleOnOrganizationSwitch,
  shouldApplyOrganizationLocale,
} from "@/lib/organization-locale-sync"
import { getOrganizationSettingsPermissionsOptions } from "@/query/organization-settings-permissions"
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
  const session = useAuthenticatedSession()!
  const uiLocale = useUiLocale()
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
  const onRoles = isOrganizationRolesPath(pathname)
  const onOrganizationSettings =
    pathname.startsWith("/app/organizations/") && pathname.endsWith("/settings")
  const onPersonalSettings = pathname === "/app/settings/preferences"
  const onAudit =
    pathname.startsWith("/app/organizations/") && pathname.endsWith("/audit")
  useDropStaleOrganizationQueries(currentOrganizationId ?? undefined)
  const access = useQuery({
    ...getOrganizationAccessOptions(currentOrganizationId ?? ""),
    enabled: Boolean(currentOrganizationId),
  })
  const settingsPermissions = useQuery({
    ...getOrganizationSettingsPermissionsOptions(currentOrganizationId ?? ""),
    enabled: Boolean(currentOrganizationId),
  })
  useEffect(() => {
    const nextLocale = access.data?.data.effectiveLocale
    if (!currentOrganizationId || !nextLocale) return
    if (
      !shouldApplyOrganizationLocale({
        userId: session.user.id,
        organizationId: currentOrganizationId,
        locale: nextLocale,
      })
    )
      return
    if (nextLocale !== uiLocale) void i18n.changeLanguage(nextLocale)
  }, [
    access.data?.data.effectiveLocale,
    currentOrganizationId,
    i18n,
    session.user.id,
    uiLocale,
  ])
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
    !onRoles &&
    !onAudit &&
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
  const rolesLink = currentOrganizationId ? (
    <Link
      to="/app/organizations/$organizationId/roles"
      params={{ organizationId: currentOrganizationId }}
    />
  ) : undefined
  const auditLink = organizationId ? (
    <Link
      to="/app/organizations/$organizationId/audit"
      params={{ organizationId }}
      search={{ limit: 20 }}
    />
  ) : undefined
  const suspended =
    access.error instanceof ApiClientError &&
    access.error.body.code === "ORGANIZATION_SUSPENDED"

  async function selectOrganization(nextOrganizationId: string) {
    const nextLocaleSnapshot = {
      userId: session.user.id,
      organizationId: nextOrganizationId,
      locale: uiLocale,
    }
    if (nextOrganizationId !== currentOrganizationId)
      preserveLocaleOnOrganizationSwitch(nextLocaleSnapshot)
    const target = organizations.find((item) => item.id === nextOrganizationId)
    if (target?.status === "ACTIVE") {
      if (!(await workspace.selectOrganization(nextOrganizationId))) {
        cancelOrganizationSwitchLocale(nextLocaleSnapshot)
        return
      }
    } else {
      cancelOrganizationSwitchLocale(nextLocaleSnapshot)
    }
    if (onRoles) {
      await navigate({
        to: "/app/organizations/$organizationId/roles",
        params: { organizationId: nextOrganizationId },
      })
      return
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
    if (onAudit) {
      await navigate({
        to: "/app/organizations/$organizationId/audit",
        params: { organizationId: nextOrganizationId },
        search: { limit: 20 },
      })
      return
    }
    await navigate({
      to: "/app/projects/$organizationId",
      params: { organizationId: nextOrganizationId },
      search: params.projectId ? {} : { ...projectListSearch, page: 1 },
    })
  }

  async function createOrganization(input: { name: string; slug: string }) {
    const nextOrganizationId = await workspace.createOrganization(input)
    if (nextOrganizationId) {
      preserveLocaleOnOrganizationSwitch({
        userId: session.user.id,
        organizationId: nextOrganizationId,
        locale: uiLocale,
      })
    }
    return nextOrganizationId
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
                {onAudit
                  ? t("organization:audit")
                  : onMembers
                    ? t("organization:members")
                    : onRoles
                      ? t("organization:roles")
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
            {
              title: t("organization:roles"),
              icon: <ShieldCheckIcon />,
              isActive: onRoles,
              disabled: !currentOrganizationId || suspended,
              render: rolesLink,
            },
            ...(settingsPermissions.data?.canRead
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
            {
              title: t("organization:audit"),
              icon: <ClipboardListIcon />,
              isActive: onAudit,
              disabled: !currentOrganizationId || suspended,
              render: auditLink,
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
        createOrganization={createOrganization}
        pending={workspace.pending}
        error={workspace.error}
        onCreated={(nextOrganizationId) => {
          void navigate({
            to: onAudit
              ? "/app/organizations/$organizationId/audit"
              : onMembers
                ? "/app/members/$organizationId"
                : onRoles
                  ? "/app/organizations/$organizationId/roles"
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
