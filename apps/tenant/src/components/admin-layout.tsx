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
import { FolderKanbanIcon, UsersIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  useGetOrganizationAccessQueryOptions,
  projectKeys,
} from "@workspace/api-client"
import {
  useDropStaleOrganizationQueries,
  useOrganizationWorkspace,
} from "@/hooks/use-organization-workspace"
import {
  CreateOrganizationDialog,
  OrganizationUnavailable,
} from "./organization-workspace"

export function AdminLayout() {
  const { t } = useTranslation(["organization", "projects", "common", "errors"])
  const session = useAuthenticatedSession()!
  const workspace = useOrganizationWorkspace()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false })
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const organizationId = params.organizationId
  const organizations = workspace.workspace.data ?? []
  const onMembers = pathname.startsWith("/app/members/")
  useDropStaleOrganizationQueries(organizationId)
  const access = useQuery({
    ...useGetOrganizationAccessQueryOptions(organizationId ?? ""),
    enabled: Boolean(organizationId),
    retry: false,
  })
  useEffect(() => {
    if (
      !organizationId ||
      !(access.error instanceof ApiClientError) ||
      access.error.body.code !== "ORGANIZATION_SUSPENDED"
    )
      return
    const queryKey = projectKeys.all(organizationId)
    void queryClient.cancelQueries({ queryKey })
    queryClient.removeQueries({ queryKey })
  }, [access.error, organizationId, queryClient])
  const projectLink = organizationId ? (
    <Link
      to="/app/projects/$organizationId"
      params={{ organizationId }}
      search={params.projectId ? {} : search}
    />
  ) : undefined
  const membersLink = organizationId ? (
    <Link to="/app/members/$organizationId" params={{ organizationId }} />
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
                {onMembers
                  ? t("organization:members")
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
              isActive: pathname.startsWith("/app/projects/"),
              disabled: !organizationId || suspended,
              render: projectLink,
            },
            {
              title: t("organization:members"),
              icon: <UsersIcon />,
              isActive: onMembers,
              disabled: !organizationId || suspended,
              render: membersLink,
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
      {organizationId && access.isPending && (
        <p role="status">{t("organization:loading")}</p>
      )}
      {suspended && (
        <OrganizationUnavailable
          organizations={organizations}
          currentId={organizationId}
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
              : "/app/projects/$organizationId",
            params: { organizationId: nextOrganizationId },
          })
        }}
      />
      {access.isSuccess ? <Outlet /> : null}
    </AppShell>
  )
}
