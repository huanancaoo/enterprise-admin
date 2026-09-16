import { useOrganizationWorkspace } from "@/hooks/use-organization-workspace"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import type { ProjectListQuery } from "@workspace/contracts"
import { App } from "@/App"
import { ProjectsList } from "./projects-list"

const projectsPath = "/app/projects/$organizationId"

export function ProjectsRoute() {
  return (
    <App>
      <ProjectsRouteContent />
    </App>
  )
}

function ProjectsRouteContent() {
  const { organizationId } = useParams({ from: projectsPath })
  const search = useSearch({ from: projectsPath })
  const navigate = useNavigate({ from: projectsPath })
  const workspace = useOrganizationWorkspace()

  return (
    <ProjectsList
      organizationId={organizationId}
      organizations={workspace.workspace.data?.organizations ?? []}
      organizationPending={workspace.pending}
      onOrganizationSelect={workspace.selectOrganization}
      search={search}
      onSearchChange={(updater) =>
        void navigate({
          search: (current: ProjectListQuery) => updater(current),
        })
      }
      onOrganizationChange={(nextOrganizationId) =>
        void navigate({
          to: projectsPath,
          params: { organizationId: nextOrganizationId },
          search: (current: ProjectListQuery) => ({ ...current, page: 1 }),
        })
      }
    />
  )
}
