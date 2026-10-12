import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { NotificationCenter } from "./notification-center"
const path = "/app/notifications/$organizationId"
export function NotificationsRoute() {
  const { organizationId } = useParams({ from: path })
  const search = useSearch({ from: path })
  const navigate = useNavigate({ from: path })
  return (
    <NotificationCenter
      key={organizationId}
      organizationId={organizationId}
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
      onOpenTask={(taskId) =>
        void navigate({
          to: "/app/tasks/$organizationId",
          params: { organizationId },
          search: { page: 1, pageSize: 20, source: "business", taskId },
        })
      }
    />
  )
}
