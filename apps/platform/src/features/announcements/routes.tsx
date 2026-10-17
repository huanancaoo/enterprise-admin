import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import {
  PlatformAnnouncementsPage,
  PlatformAnnouncementEditPage,
  PlatformAnnouncementPreviewPage,
  PlatformAnnouncementInboxPage,
  PlatformAnnouncementReadPage,
  PlatformAnnouncementReadersPage,
} from "./pages"
export function PlatformAnnouncementsRoute() {
  const search = useSearch({ from: "/platform/announcements" })
  const navigate = useNavigate()
  return (
    <PlatformAnnouncementsPage
      search={search}
      onSearchChange={(next) =>
        void navigate({ to: "/platform/announcements", search: next })
      }
      onCreate={() => void navigate({ to: "/platform/announcements/new" })}
      onEdit={(announcementId) =>
        void navigate({
          to: "/platform/announcements/$announcementId/edit",
          params: { announcementId },
        })
      }
      onView={(announcementId) =>
        void navigate({
          to: "/platform/announcements/$announcementId",
          params: { announcementId },
        })
      }
      onReaders={(announcementId) =>
        void navigate({
          to: "/platform/announcements/$announcementId/readers",
          params: { announcementId },
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}
export function PlatformAnnouncementCreateRoute() {
  const navigate = useNavigate()
  return (
    <PlatformAnnouncementEditPage
      onBack={() =>
        void navigate({
          to: "/platform/announcements",
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}
export function PlatformAnnouncementEditRoute() {
  const { announcementId } = useParams({
    from: "/platform/announcements/$announcementId/edit",
  })
  const navigate = useNavigate()
  return (
    <PlatformAnnouncementEditPage
      announcementId={announcementId}
      onBack={() =>
        void navigate({
          to: "/platform/announcements",
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}
export function PlatformAnnouncementInboxRoute() {
  const search = useSearch({ from: "/platform/announcement-inbox" })
  const navigate = useNavigate()
  return (
    <PlatformAnnouncementInboxPage
      search={search}
      onSearchChange={(next) =>
        void navigate({ to: "/platform/announcement-inbox", search: next })
      }
      onOpen={(announcementId) =>
        void navigate({
          to: "/platform/announcement-inbox/$announcementId",
          params: { announcementId },
        })
      }
    />
  )
}
export function PlatformAnnouncementReadRoute() {
  const { announcementId } = useParams({
    from: "/platform/announcement-inbox/$announcementId",
  })
  const navigate = useNavigate()
  return (
    <PlatformAnnouncementReadPage
      announcementId={announcementId}
      onBack={() =>
        void navigate({
          to: "/platform/announcement-inbox",
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}
export function PlatformAnnouncementReadersRoute() {
  const { announcementId } = useParams({
    from: "/platform/announcements/$announcementId/readers",
  })
  const search = useSearch({
    from: "/platform/announcements/$announcementId/readers",
  })
  const navigate = useNavigate({
    from: "/platform/announcements/$announcementId/readers",
  })
  return (
    <PlatformAnnouncementReadersPage
      announcementId={announcementId}
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
      onBack={() =>
        void navigate({
          to: "/platform/announcements",
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}

export function PlatformAnnouncementPreviewRoute() {
  const { announcementId } = useParams({
    from: "/platform/announcements/$announcementId",
  })
  const navigate = useNavigate()
  return (
    <PlatformAnnouncementPreviewPage
      announcementId={announcementId}
      onBack={() =>
        void navigate({
          to: "/platform/announcements",
          search: { page: 1, pageSize: 20 },
        })
      }
    />
  )
}
