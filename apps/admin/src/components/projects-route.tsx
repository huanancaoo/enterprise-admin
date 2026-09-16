import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import type { ProjectListQuery } from "@workspace/contracts"
import { ProjectsList } from "./projects-list"

const projectsPath = "/app/projects/$organizationId"

export function ProjectsRoute() {
  const { organizationId } = useParams({ from: projectsPath })
  const search = useSearch({ from: projectsPath })
  const navigate = useNavigate({ from: projectsPath })

  return (
    <ProjectsList
      organizationId={organizationId}
      search={search}
      onSearchChange={(updater) =>
        void navigate({
          search: (current: ProjectListQuery) => updater(current),
        })
      }
    />
  )
}
