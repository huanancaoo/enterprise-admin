import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  AnnouncementEntry,
  AnnouncementInbox,
  AnnouncementArticle,
  LoadingState,
  ErrorState,
  saveAnnouncementResource,
  useAnnouncementUnreadQuery,
  useAnnouncementInboxQuery,
  useAnnouncementReading,
  type AnnouncementInboxSearch,
} from "@workspace/admin"
import {
  listTenantAnnouncements,
  getTenantAnnouncement,
  readTenantAnnouncement,
  getTenantAnnouncementMedia,
} from "@workspace/api-client"
import { ReadAnnouncementSchema } from "@workspace/contracts/platform-announcements"

const keys = {
  scope: (organizationId: string, userId: string) =>
    [
      "organizations",
      organizationId,
      "users",
      userId,
      "announcements",
    ] as const,
}
export function TenantAnnouncementEntry({
  organizationId,
  onOpen,
}: {
  organizationId: string
  onOpen: () => void
}) {
  const user = useAuthenticatedSession()!.user
  const query = useAnnouncementUnreadQuery(
    keys.scope(organizationId, user.id),
    (signal) =>
      listTenantAnnouncements(
        organizationId,
        { page: 1, pageSize: 1 },
        { signal },
      ).then((reply) => reply.data),
  )
  return (
    <AnnouncementEntry
      unreadCount={query.isError ? undefined : query.data?.unreadCount}
      onOpen={onOpen}
      error={query.isError}
    />
  )
}
export function TenantAnnouncementInbox({
  organizationId,
  search,
  onSearchChange,
  onOpen,
}: {
  organizationId: string
  search: AnnouncementInboxSearch
  onSearchChange: (value: AnnouncementInboxSearch) => void
  onOpen: (id: string) => void
}) {
  const user = useAuthenticatedSession()!.user
  const { query, status } = useAnnouncementInboxQuery(
    keys.scope(organizationId, user.id),
    search,
    (signal) =>
      listTenantAnnouncements(organizationId, search, { signal }).then(
        (reply) => reply.data,
      ),
  )
  return (
    <AnnouncementInbox
      items={query.data?.items ?? []}
      total={query.data?.total ?? 0}
      search={search}
      onSearchChange={onSearchChange}
      onOpen={(item) => onOpen(item.id)}
      status={status}
      error={query.error?.message}
      onRetry={() => void query.refetch()}
    />
  )
}
export function TenantAnnouncementRead({
  organizationId,
  announcementId,
  onBack,
}: {
  organizationId: string
  announcementId: string
  onBack: () => void
}) {
  const { t } = useTranslation("announcements")
  const user = useAuthenticatedSession()!.user
  const client = useQueryClient()
  const scope = keys.scope(organizationId, user.id)
  const reading = useAnnouncementReading({
    scope,
    announcementId,
    contentScopeKey: [
      "tenant-announcement",
      organizationId,
      user.id,
      announcementId,
    ],
    load: (signal) =>
      getTenantAnnouncement(organizationId, announcementId, { signal }).then(
        (reply) => reply.data,
      ),
    markRead: (publicationId) =>
      readTenantAnnouncement(
        organizationId,
        announcementId,
        ReadAnnouncementSchema.parse({ publicationId }),
      ).then((reply) => reply.data),
    invalidate: () =>
      // 已读按用户和发布批次共享，切换到另一目标组织时也应看到相同阅读状态。
      client.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === "organizations" &&
          queryKey[2] === "users" &&
          queryKey[3] === user.id &&
          queryKey[4] === "announcements",
      }),
    resolveImage: async (reference, signal) =>
      (
        await getTenantAnnouncementMedia(
          organizationId,
          reference.fileId,
          { versionId: reference.versionId },
          { signal },
        )
      ).data,
    downloadFile: async (reference) =>
      saveAnnouncementResource(
        await getTenantAnnouncementMedia(organizationId, reference.fileId, {
          versionId: reference.versionId,
        }),
      ),
    getFileErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
  })
  if (reading.query.isPending) return <LoadingState />
  if (reading.query.isError)
    return (
      <ErrorState
        message={reading.query.error.message}
        onRetry={() => void reading.query.refetch()}
      />
    )
  return (
    <AnnouncementArticle
      item={reading.query.data}
      unread={reading.query.data.unread}
      ports={reading.ports}
      onBack={onBack}
      onMarkRead={reading.onMarkRead}
      markingRead={reading.markingRead}
      readError={reading.readFailed ? t("readFailed") : undefined}
    />
  )
}
