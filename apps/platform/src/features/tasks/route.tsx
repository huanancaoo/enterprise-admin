import { useNavigate, useSearch } from "@tanstack/react-router"
import { PlatformTasksPage } from "./pages"
export function PlatformTasksRoute() {
  const search = useSearch({ from: "/platform/tasks" })
  const navigate = useNavigate({ from: "/platform/tasks" })
  return (
    <PlatformTasksPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  )
}
