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
      onTaskCreated={(task) =>
        void navigate({
          to: "/app/tasks/$organizationId",
          params: { organizationId },
          search: {
            page: 1,
            pageSize: 20,
            source: "business",
            taskId: task.id,
          },
        })
      }
      onSearchChange={(updater) =>
        void navigate({
          search: (current: ProjectListQuery) => updater(current),
        })
      }
    />
  )
}
