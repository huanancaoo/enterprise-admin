import { useNavigate, useParams } from "@tanstack/react-router"
import { App } from "@/App"
import { useOrganizationWorkspace } from "@/hooks/use-organization-workspace"
import { ProjectDetail } from "./project-detail"

const detailPath = "/app/projects/$organizationId/$projectId"

export function ProjectDetailRoute() {
  return (
    <App>
      <ProjectDetailRouteContent />
    </App>
  )
}

function ProjectDetailRouteContent() {
  const { organizationId, projectId } = useParams({ from: detailPath })
  const navigate = useNavigate({ from: detailPath })
  const workspace = useOrganizationWorkspace()

  return (
    <ProjectDetail
      organizationId={organizationId}
      projectId={projectId}
      organizations={workspace.workspace.data?.organizations ?? []}
      organizationPending={workspace.pending}
      onOrganizationSelect={workspace.selectOrganization}
      onOrganizationChange={(nextOrganizationId) =>
        void navigate({
          to: "/app/projects/$organizationId",
          params: { organizationId: nextOrganizationId },
          search: {},
        })
      }
    />
  )
}
