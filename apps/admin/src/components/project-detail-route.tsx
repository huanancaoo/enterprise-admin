import { useParams } from "@tanstack/react-router"
import { ProjectDetail } from "./project-detail"

const detailPath = "/app/projects/$organizationId/$projectId"

export function ProjectDetailRoute() {
  const { organizationId, projectId } = useParams({ from: detailPath })

  return <ProjectDetail organizationId={organizationId} projectId={projectId} />
}
