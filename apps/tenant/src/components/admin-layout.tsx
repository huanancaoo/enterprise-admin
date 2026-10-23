import { getOrganizationSettingsPermissionsOptions } from "@/features/organization/organization-settings-permissions"
import { useOrganizationNavigation } from "@/hooks/use-organization-navigation"
import {
  useDropStaleOrganizationQueries,
  useOrganizationWorkspace,
} from "@/hooks/use-organization-workspace"
import { authClient } from "@/lib/auth-client"
import {
  preserveLocaleOnManualSelection,
  shouldApplyOrganizationLocale,
} from "@/lib/organization-locale-sync"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { AdminPage, AppShell, WorkspacePage } from "@workspace/admin"
import {
  DeviceSessionActions,
  DeviceSessionMenu,
  useAuthenticatedSession,
} from "@workspace/admin/auth"
import {
  ApiClientError,
  getMyPreferencesOptions,
  getOrganizationAccessOptions,
  organizationKeys,
} from "@workspace/api-client"
import { useUiLocale } from "@workspace/i18n/react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import {
  ListTodoIcon,
  ClipboardListIcon,
  FolderKanbanIcon,
  FolderOpenIcon,
  PlugIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CreateOrganizationDialog,
  OrganizationUnavailable,
} from "./organization-workspace"
import { WorkspaceActions } from "./workspace-actions"

export function AdminLayout() {
  const { t, i18n } = useTranslation([
    "organization",
    "projects",
    "files",
    "credentials",
    "tasks",
    "notifications",
    "announcements",
    "webhooks",
    "settings",
    "identity",
    "common",
    "errors",
  ])
  const session = useAuthenticatedSession()!
  const uiLocale = useUiLocale()
  const personalPreferences = useQuery(getMyPreferencesOptions(session.user.id))
  const workspace = useOrganizationWorkspace()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
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
  // 未读回的组织与已确认的无组织不同，不能先挂载表单再由访问检查将其卸载。
  const organizationContextPending =
    !organizationId && activeOrganization.isPending
  const organizations = workspace.workspace.data ?? []
  const location = useOrganizationNavigation(workspace, currentOrganizationId)
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
    const inheritedLocale = personalPreferences.data?.data.effectiveLocale
    if (
      organizationId ||
      !activeOrganization.isSuccess ||
      activeOrganization.data !== null ||
      !personalPreferences.isSuccess ||
      personalPreferences.isFetching ||
      !inheritedLocale
    )
      return
    if (
      !shouldApplyOrganizationLocale({
        userId: session.user.id,
        organizationId: null,
        locale: inheritedLocale,
      })
    )
      return
    if (i18n.resolvedLanguage !== inheritedLocale)
      void i18n.changeLanguage(inheritedLocale)
  }, [
    activeOrganization.data,
    activeOrganization.isSuccess,
    i18n,
    organizationId,
    personalPreferences.data?.data.effectiveLocale,
    personalPreferences.isFetching,
    personalPreferences.isSuccess,
    session.user.id,
  ])
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
  const projectLink = currentOrganizationId ? (
    <Link {...location.link("projects", currentOrganizationId)} />
  ) : undefined
  const filesLink = currentOrganizationId ? (
    <Link {...location.link("files", currentOrganizationId)} />
  ) : undefined
  const tasksLink = currentOrganizationId ? (
    <Link {...location.link("tasks", currentOrganizationId)} />
  ) : undefined
  const integrationsLink = currentOrganizationId ? (
    <Link {...location.link("integrations", currentOrganizationId)} />
  ) : undefined
  const membersLink = currentOrganizationId ? (
    <Link {...location.link("members", currentOrganizationId)} />
  ) : undefined
  const organizationSettingsLink = currentOrganizationId ? (
    <Link {...location.link("organizationSettings", currentOrganizationId)} />
  ) : undefined
  const rolesLink = currentOrganizationId ? (
    <Link {...location.link("roles", currentOrganizationId)} />
  ) : undefined
  const auditLink = currentOrganizationId ? (
    <Link {...location.link("audit", currentOrganizationId)} />
  ) : undefined
  const suspended =
    access.error instanceof ApiClientError &&
    access.error.body.code === "ORGANIZATION_SUSPENDED"

  const canRenderPage =
    location.personal ||
    (!organizationContextPending &&
      (!currentOrganizationId || access.isSuccess))
  const BlockedPage =
    location.layout === "workspace" ? WorkspacePage : AdminPage

  return (
    <AppShell
      layout={location.layout}
      actions={
        <WorkspaceActions
          organizationId={currentOrganizationId}
          disabled={suspended}
        />
      }
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            {location.sectionTitleKey && (
              <>
                <BreadcrumbItem className="hidden md:block">
                  <span>{t(location.sectionTitleKey)}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
              </>
            )}
            {location.projectDetail && (
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
              <BreadcrumbPage>{t(location.titleKey)}</BreadcrumbPage>
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
          onSelect: (id) => void location.selectOrganization(id),
          onCreate: () => setCreateOpen(true),
        },
        navigation: [
          {
            label: t("organization:businessWork"),
            items: [
              {
                title: t("projects:title"),
                icon: <FolderKanbanIcon />,
                isActive: location.page === "projects" && !location.personal,
                disabled: !currentOrganizationId || suspended,
                render: projectLink,
              },
              {
                title: t("files:title"),
                icon: <FolderOpenIcon />,
                isActive: location.page === "files",
                disabled: !currentOrganizationId || suspended,
                render: filesLink,
              },
              {
                title: t("tasks:title"),
                icon: <ListTodoIcon />,
                isActive: location.page === "tasks",
                disabled: !currentOrganizationId || suspended,
                render: tasksLink,
              },
            ],
          },
          {
            label: t("organization:management"),
            items: [
              {
                title: t("organization:membersAndInvitations"),
                icon: <UsersIcon />,
                isActive: location.page === "members",
                disabled: !currentOrganizationId || suspended,
                render: membersLink,
              },
              {
                title: t("organization:rolesAndPermissions"),
                icon: <ShieldCheckIcon />,
                isActive: location.page === "roles",
                disabled: !currentOrganizationId || suspended,
                render: rolesLink,
              },
              {
                title: t("organization:audit"),
                icon: <ClipboardListIcon />,
                isActive: location.page === "audit",
                disabled: !currentOrganizationId || suspended,
                render: auditLink,
              },
              // 设置读取权限只控制这个入口，不代表整个组织管理分区的权限。
              ...(settingsPermissions.data?.canRead
                ? [
                    {
                      title: t("settings:generalSettings"),
                      icon: <SettingsIcon />,
                      isActive: location.page === "organizationSettings",
                      disabled: !currentOrganizationId || suspended,
                      render: organizationSettingsLink,
                    },
                  ]
                : []),
            ],
          },
          {
            label: t("organization:developerIntegration"),
            items: [
              {
                title: t("webhooks:integrations"),
                icon: <PlugIcon />,
                isActive: location.page === "integrations",
                disabled: !currentOrganizationId || suspended,
                render: integrationsLink,
              },
            ],
          },
        ],
        user: {
          user: {
            name: session.user.name,
            email: session.user.email,
            avatar: session.user.image ?? undefined,
          },
          accountMenu: (action) => (
            <DeviceSessionMenu
              action={action}
              onAddAccount={() => void navigate({ to: "/add-account" })}
            />
          ),
          signOutMenu: (action) => <DeviceSessionActions action={action} />,
          onPersonalSettings: () =>
            void navigate({ to: "/app/settings/preferences" }),
          onLocaleSelect: () =>
            preserveLocaleOnManualSelection({
              userId: session.user.id,
              organizationId: currentOrganizationId ?? null,
            }),
        },
      }}
    >
      {workspace.error && (
        <p
          role="alert"
          className="mx-auto w-full max-w-7xl shrink-0 px-4 py-3 text-sm text-destructive sm:px-6 lg:px-8"
        >
          {workspace.error}
        </p>
      )}
      {!canRenderPage && (
        <BlockedPage title={t(location.titleKey)}>
          {(organizationContextPending ||
            (currentOrganizationId && access.isPending)) && (
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
        </BlockedPage>
      )}
      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createOrganization={location.createOrganization}
        pending={workspace.pending}
        error={workspace.error}
        onCreated={location.onCreated}
      />
      {canRenderPage && <Outlet />}
    </AppShell>
  )
}
