import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router"
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
import { FolderKanbanIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useOrganizationWorkspace } from "@/hooks/use-organization-workspace"
import { AdminWorkspaceContext } from "@/hooks/admin-workspace-context"

export function AdminLayout() {
  const { t } = useTranslation(["organization", "projects", "common"])
  const session = useAuthenticatedSession()!
  const workspace = useOrganizationWorkspace()
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  // 租户业务以 URL 组织为准；组织选择页才使用会话中的工作区偏好。
  const organizationId =
    params.organizationId ?? workspace.workspace.data?.active?.id
  const projectLink = organizationId ? (
    <Link
      to="/app/projects/$organizationId"
      params={{ organizationId }}
      search={params.projectId ? {} : search}
    />
  ) : undefined

  async function selectOrganization(nextOrganizationId: string) {
    if (!(await workspace.selectOrganization(nextOrganizationId))) return
    if (params.organizationId) {
      await navigate({
        to: "/app/projects/$organizationId",
        params: { organizationId: nextOrganizationId },
        search: params.projectId ? {} : { ...search, page: 1 },
      })
    }
  }

  return (
    <AdminWorkspaceContext.Provider value={workspace}>
      <AppShell
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              {params.organizationId && (
                <>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink
                      render={<Link to="/app/select-organization" />}
                    >
                      {t("organization:management")}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                </>
              )}
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
                  {params.projectId
                    ? t("projects:detail")
                    : params.organizationId
                      ? t("projects:title")
                      : t("organization:management")}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        sidebar={{
          teamSwitcher: {
            teams: (workspace.workspace.data?.organizations ?? []).map(
              (organization) => ({
                id: organization.id,
                name: organization.name,
                description: t("organization:management"),
              })
            ),
            value: organizationId ?? null,
            label: t("organization:select"),
            disabled: workspace.pending,
            onSelect: (id) => void selectOrganization(id),
          },
          navigation: {
            label: t("common:navigation"),
            items: [
              {
                title: t("projects:title"),
                icon: <FolderKanbanIcon />,
                isActive: !!params.organizationId,
                disabled: !organizationId,
                render: projectLink,
              },
            ],
          },
          user: {
            user: {
              name: session.user.name,
              email: session.user.email,
              avatar: session.user.image ?? undefined,
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
        <Outlet />
      </AppShell>
    </AdminWorkspaceContext.Provider>
  )
}
