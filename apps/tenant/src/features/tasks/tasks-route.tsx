import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { TaskCenter } from "./task-center"
const path = "/app/tasks/$organizationId"
export function TasksRoute() {
  const { organizationId } = useParams({ from: path })
  const search = useSearch({ from: path })
  const navigate = useNavigate({ from: path })
  return (
    <TaskCenter
      key={organizationId}
      organizationId={organizationId}
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  )
}
