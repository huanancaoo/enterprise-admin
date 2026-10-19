import { useCallback, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  AnnouncementEntry,
  AnnouncementInbox,
  AnnouncementArticle,
  LoadingState,
  ErrorState,
  saveAnnouncementResource,
  type AnnouncementInboxSearch,
} from "@workspace/admin"
import type { FileContentPorts } from "@workspace/admin/rich-text-editor"
import { getDataTableQueryStatus } from "@workspace/admin/data-table"
import {
  listTenantAnnouncements,
  getTenantAnnouncement,
  readTenantAnnouncement,
  getTenantAnnouncementMedia,
} from "@workspace/api-client"
import {
  AnnouncementInboxPageSchema,
  AnnouncementReadingSchema,
  AnnouncementReadResultSchema,
  ReadAnnouncementSchema,
} from "@workspace/contracts/platform-announcements"

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
  const query = useQuery({
    queryKey: [...keys.scope(organizationId, user.id), "unread"],
    queryFn: async ({ signal }) =>
      AnnouncementInboxPageSchema.parse(
        (
          await listTenantAnnouncements(
            organizationId,
            { page: 1, pageSize: 1 },
            { signal }
          )
        ).data
      ),
    retry: false,
  })
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
  const query = useQuery({
    queryKey: [...keys.scope(organizationId, user.id), "list", search],
    queryFn: async ({ signal }) =>
      AnnouncementInboxPageSchema.parse(
        (await listTenantAnnouncements(organizationId, search, { signal })).data
      ),
    retry: false,
  })
  return (
    <AnnouncementInbox
      items={query.data?.items ?? []}
      total={query.data?.total ?? 0}
      search={search}
      onSearchChange={onSearchChange}
      onOpen={(item) => onOpen(item.id)}
      status={getDataTableQueryStatus(query)}
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
  const key = [
    ...keys.scope(organizationId, user.id),
    "reading",
    announcementId,
  ] as const
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      AnnouncementReadingSchema.parse(
        (
          await getTenantAnnouncement(organizationId, announcementId, {
            signal,
          })
        ).data
      ),
    retry: false,
  })
  const mark = useMutation({
    mutationFn: async (publicationId: string) =>
      AnnouncementReadResultSchema.parse(
        (
          await readTenantAnnouncement(
            organizationId,
            announcementId,
            ReadAnnouncementSchema.parse({ publicationId })
          )
        ).data
      ),
    onSuccess: async () => {
      client.setQueryData(
        key,
        (previous: z.infer<typeof AnnouncementReadingSchema> | undefined) =>
          previous ? { ...previous, unread: false } : previous
      )
      // 已读按用户和发布批次共享，切换到另一目标组织时也应看到相同阅读状态。
      await client.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === "organizations" &&
          queryKey[2] === "users" &&
          queryKey[3] === user.id &&
          queryKey[4] === "announcements",
      })
    },
  })
  const publicationId = query.data?.publicationId
  const mutate = mark.mutate
  const onMarkRead = useCallback(() => {
    mutate(z.uuid().parse(publicationId))
  }, [mutate, publicationId])
  const ports = useMemo<FileContentPorts>(
    () => ({
      contentScopeKey: JSON.stringify([
        "tenant-announcement",
        organizationId,
        user.id,
        announcementId,
        publicationId,
      ]),
      resolveImage: async (reference, signal) =>
        (
          await getTenantAnnouncementMedia(
            organizationId,
            reference.fileId,
            { versionId: reference.versionId },
            { signal }
          )
        ).data,
      downloadFile: async (reference) =>
        saveAnnouncementResource(
          await getTenantAnnouncementMedia(organizationId, reference.fileId, {
            versionId: reference.versionId,
          })
        ),
      getFileErrorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
    }),
    [announcementId, organizationId, publicationId, user.id]
  )
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    )
  return (
    <AnnouncementArticle
      item={query.data}
      unread={query.data.unread}
      ports={ports}
      onBack={onBack}
      onMarkRead={onMarkRead}
      markingRead={mark.isPending}
      readError={mark.isError ? t("readFailed") : undefined}
    />
  )
}
