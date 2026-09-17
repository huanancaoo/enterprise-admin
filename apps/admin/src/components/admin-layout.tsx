import { useState } from "react"
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
import { CreateOrganizationDialog } from "./organization-workspace"

export function AdminLayout() {
  const { t } = useTranslation(["organization", "projects", "common"])
  const session = useAuthenticatedSession()!
  const workspace = useOrganizationWorkspace()
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const organizationId = params.organizationId
  const projectLink = organizationId ? (
    <Link
      to="/app/projects/$organizationId"
      params={{ organizationId }}
      search={params.projectId ? {} : search}
    />
  ) : undefined

  async function selectOrganization(nextOrganizationId: string) {
    if (!(await workspace.selectOrganization(nextOrganizationId))) return
    await navigate({
      to: "/app/projects/$organizationId",
      params: { organizationId: nextOrganizationId },
      search: params.projectId ? {} : { ...search, page: 1 },
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
                {params.projectId ? t("projects:detail") : t("projects:title")}
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
            })
          ),
          value: organizationId ?? null,
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
      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createOrganization={workspace.createOrganization}
        pending={workspace.pending}
        error={workspace.error}
        onCreated={(nextOrganizationId) => {
          void navigate({
            to: "/app/projects/$organizationId",
            params: { organizationId: nextOrganizationId },
          })
        }}
      />
      <Outlet />
    </AppShell>
  )
}
