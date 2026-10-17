import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import {
  TenantAnnouncementInbox,
  TenantAnnouncementRead,
} from "./announcements"
export function TenantAnnouncementInboxRoute() {
  const { organizationId } = useParams({
    from: "/app/announcements/$organizationId",
  })
  const search = useSearch({ from: "/app/announcements/$organizationId" })
  const navigate = useNavigate()
  return (
    <TenantAnnouncementInbox
      organizationId={organizationId}
      search={search}
      onSearchChange={(next) =>
        void navigate({
          to: "/app/announcements/$organizationId",
          params: { organizationId },
          search: next,
        })
      }
      onOpen={(announcementId) =>
        void navigate({
          to: "/app/announcements/$organizationId/$announcementId",
          params: { organizationId, announcementId },
        })
      }
    />
  )
}
export function TenantAnnouncementReadRoute() {
  const { organizationId, announcementId } = useParams({
    from: "/app/announcements/$organizationId/$announcementId",
  })
  const navigate = useNavigate()
  return (
    <TenantAnnouncementRead
      organizationId={organizationId}
      announcementId={announcementId}
      onBack={() =>
        void navigate({
          to: "/app/announcements/$organizationId",
          params: { organizationId },
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}
