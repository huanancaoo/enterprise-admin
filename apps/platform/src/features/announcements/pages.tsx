import { useCallback, useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  AnnouncementEntry,
  AnnouncementInbox,
  AnnouncementArticle,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  saveAnnouncementResource,
  type AnnouncementInboxSearch,
} from "@workspace/admin"
import type { FileContentPorts } from "@workspace/admin/rich-text-editor"
import { getDataTableQueryStatus } from "@workspace/admin/data-table"
import {
  ApiClientError,
  listPlatformAnnouncements,
  createPlatformAnnouncement,
  getPlatformAnnouncement,
  updatePlatformAnnouncement,
  publishPlatformAnnouncement,
  withdrawPlatformAnnouncement,
  deletePlatformAnnouncement,
  listPlatformAnnouncementReaders,
  uploadPlatformAnnouncementMedia,
  getPlatformAnnouncementMedia,
  listPlatformAnnouncementInbox,
  getPlatformAnnouncementInboxMedia,
  getPlatformAnnouncementReading,
  readPlatformAnnouncement,
} from "@workspace/api-client"
import {
  AnnouncementPageSchema,
  AnnouncementDetailSchema,
  AnnouncementInboxPageSchema,
  AnnouncementReadingSchema,
  AnnouncementAttachmentSchema,
  AnnouncementRichTextDocumentSchema,
  AnnouncementReadResultSchema,
  AnnouncementReadersPageSchema,
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  PublishAnnouncementSchema,
  AnnouncementVersionSchema,
  ReadAnnouncementSchema,
} from "@workspace/contracts/platform-announcements"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import {
  AnnouncementList,
  type AnnouncementManagementSearch,
} from "./announcement-list"
import {
  AnnouncementEditor,
  type AnnouncementDraftValue,
} from "./announcement-editor"
import { AnnouncementOrganizationsField } from "./announcement-organizations"
import { AnnouncementReaders } from "./announcement-readers"

const platformAnnouncementKeys = {
  manage: (userId: string) => ["platform", userId, "announcements"] as const,
  inbox: (userId: string) =>
    ["platform", userId, "announcement-inbox"] as const,
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
export function PlatformAnnouncementsPage({
  search,
  onSearchChange,
  onCreate,
  onEdit,
  onView,
  onReaders,
}: {
  search: AnnouncementManagementSearch
  onSearchChange: (value: AnnouncementManagementSearch) => void
  onCreate: () => void
  onEdit: (id: string) => void
  onView: (id: string) => void
  onReaders: (id: string) => void
}) {
  const user = useAuthenticatedSession()!.user
  const client = useQueryClient()
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const prefix = platformAnnouncementKeys.manage(user.id)
  const query = useQuery({
    queryKey: [...prefix, "list", search],
    queryFn: async ({ signal }) =>
      AnnouncementPageSchema.parse(
        (await listPlatformAnnouncements(search, { signal })).data
      ),
    retry: false,
  })
  const rejectAccess = usePlatformAccessFailure(query.error)
  const write = async (request: () => Promise<unknown>) => {
    try {
      await request()
      await client.invalidateQueries({ queryKey: prefix })
      await client.invalidateQueries({
        queryKey: platformAnnouncementKeys.inbox(user.id),
      })
    } catch (error) {
      void rejectAccess(error)
      throw error
    }
  }
  return (
    <AnnouncementList
      items={query.data?.items ?? []}
      total={query.data?.total ?? 0}
      search={search}
      onSearchChange={onSearchChange}
      status={getDataTableQueryStatus(query)}
      error={query.error?.message}
      onRetry={() => void query.refetch()}
      permissions={platformAccess.permissions}
      onCreate={onCreate}
      onEdit={onEdit}
      onView={onView}
      onReaders={onReaders}
      onPublish={(id, value, version) =>
        write(() =>
          publishPlatformAnnouncement(
            id,
            PublishAnnouncementSchema.parse({
              expectedVersion: version,
              audience: value.target,
              organizationIds:
                value.target === "organizations" ? value.organizationIds : [],
            })
          )
        )
      }
      onWithdraw={(id, version) =>
        write(() =>
          withdrawPlatformAnnouncement(
            id,
            AnnouncementVersionSchema.parse({ expectedVersion: version })
          )
        )
      }
      onDelete={(id, version) =>
        write(() =>
          deletePlatformAnnouncement(
            id,
            AnnouncementVersionSchema.parse({ expectedVersion: version })
          )
        )
      }
      renderOrganizations={(value, onChange, invalid) => (
        <AnnouncementOrganizationsField
          value={value}
          onChange={onChange}
          invalid={invalid}
        />
      )}
    />
  )
}
export function PlatformAnnouncementEditPage({
  announcementId,
  onBack,
}: {
  announcementId?: string
  onBack: () => void
}) {
  const user = useAuthenticatedSession()!.user
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const canEdit = platformAccess.permissions.includes(
    announcementId
      ? "platform.announcement:update"
      : "platform.announcement:create"
  )
  const query = useQuery({
    queryKey: [
      ...platformAnnouncementKeys.manage(user.id),
      "detail",
      announcementId,
    ],
    enabled: canEdit && Boolean(announcementId),
    queryFn: async ({ signal }) =>
      AnnouncementDetailSchema.parse(
        (await getPlatformAnnouncement(announcementId!, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  if (!canEdit) return <PermissionDeniedState />
  if (announcementId && query.isPending) return <LoadingState />
  if (
    query.isError &&
    (!query.data ||
      (query.error instanceof ApiClientError &&
        [401, 403].includes(query.error.status)))
  )
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    )
  return (
    <PlatformAnnouncementEditingSession
      key={announcementId ?? "new"}
      initialDetail={query.data}
      onBack={onBack}
    />
  )
}
function PlatformAnnouncementEditingSession({
  initialDetail,
  onBack,
}: {
  initialDetail: z.infer<typeof AnnouncementDetailSchema> | undefined
  onBack: () => void
}) {
  const user = useAuthenticatedSession()!.user
  const client = useQueryClient()
  // 正文草稿和expectedVersion属于同一个编辑会话；后台重取不能推进旧草稿的版本。
  const { t } = useTranslation("announcements")
  const [detail] = useState(() => initialDetail)
  const [newScope] = useState(() => crypto.randomUUID())
  const rejectAccess = usePlatformAccessFailure()
  const ports = useMemo<FileContentPorts>(
    () => ({
      contentScopeKey: JSON.stringify([
        "announcement-editor",
        user.id,
        detail?.id ?? newScope,
      ]),
      resolveImage: async (reference, signal) =>
        (
          await getPlatformAnnouncementMedia(
            reference.fileId,
            { versionId: reference.versionId },
            { signal }
          )
        ).data,
      downloadFile: async (reference) =>
        saveAnnouncementResource(
          await getPlatformAnnouncementMedia(reference.fileId, {
            versionId: reference.versionId,
          })
        ),
      getFileErrorMessage: message,
    }),
    [detail?.id, newScope, user.id]
  )
  if (detail?.status === "published")
    return <ErrorState message={t("batchHint")} onRetry={onBack} />
  const initialValue: AnnouncementDraftValue = detail
    ? {
        title: detail.title,
        type: detail.type,
        content: detail.content,
        attachments: detail.attachments,
      }
    : {
        title: "",
        type: "notice",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        attachments: [],
      }
  return (
    <AnnouncementEditor
      mode={detail ? "edit" : "create"}
      initialValue={initialValue}
      ports={ports}
      onUploadImage={async (file, options) => {
        options.onStage("transmitting")
        const value = AnnouncementAttachmentSchema.parse(
          (
            await uploadPlatformAnnouncementMedia(
              { file },
              { signal: options.signal }
            )
          ).data
        )
        options.onStage("confirming")
        return { fileId: value.fileId, versionId: value.versionId }
      }}
      onUploadAttachment={async (file, signal) =>
        AnnouncementAttachmentSchema.parse(
          (await uploadPlatformAnnouncementMedia({ file }, { signal })).data
        )
      }
      onSave={async (value) => {
        const fields = {
          title: value.title,
          type: value.type,
          content: AnnouncementRichTextDocumentSchema.parse(value.content),
          attachments: value.attachments.map(({ fileId, versionId }) => ({
            fileId,
            versionId,
          })),
          audience: detail?.audience ?? "platform",
          organizationIds: detail?.organizationIds ?? [],
        }
        try {
          if (detail)
            AnnouncementDetailSchema.parse(
              (
                await updatePlatformAnnouncement(
                  detail.id,
                  UpdateAnnouncementSchema.parse({
                    ...fields,
                    expectedVersion: detail.version,
                  })
                )
              ).data
            )
          else
            AnnouncementDetailSchema.parse(
              (
                await createPlatformAnnouncement(
                  CreateAnnouncementSchema.parse(fields)
                )
              ).data
            )
          await client.invalidateQueries({
            queryKey: platformAnnouncementKeys.manage(user.id),
          })
          onBack()
        } catch (error) {
          void rejectAccess(error)
          throw error
        }
      }}
      onBack={onBack}
    />
  )
}
export function PlatformAnnouncementInboxPage({
  search,
  onSearchChange,
  onOpen,
}: {
  search: AnnouncementInboxSearch
  onSearchChange: (value: AnnouncementInboxSearch) => void
  onOpen: (id: string) => void
}) {
  const user = useAuthenticatedSession()!.user
  const query = useQuery({
    queryKey: [...platformAnnouncementKeys.inbox(user.id), "list", search],
    queryFn: async ({ signal }) =>
      AnnouncementInboxPageSchema.parse(
        (await listPlatformAnnouncementInbox(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
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
export function PlatformAnnouncementEntry({ onOpen }: { onOpen: () => void }) {
  const user = useAuthenticatedSession()!.user
  const query = useQuery({
    queryKey: [...platformAnnouncementKeys.inbox(user.id), "unread"],
    queryFn: async ({ signal }) =>
      AnnouncementInboxPageSchema.parse(
        (
          await listPlatformAnnouncementInbox(
            { page: 1, pageSize: 1 },
            { signal }
          )
        ).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  return (
    <AnnouncementEntry
      unreadCount={query.isError ? undefined : query.data?.unreadCount}
      onOpen={onOpen}
      error={query.isError}
    />
  )
}
export function PlatformAnnouncementReadPage({
  announcementId,
  onBack,
}: {
  announcementId: string
  onBack: () => void
}) {
  const { t } = useTranslation("announcements")
  const user = useAuthenticatedSession()!.user
  const client = useQueryClient()
  const key = [
    ...platformAnnouncementKeys.inbox(user.id),
    "reading",
    announcementId,
  ] as const
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      AnnouncementReadingSchema.parse(
        (await getPlatformAnnouncementReading(announcementId, { signal })).data
      ),
    retry: false,
  })
  const rejectAccess = usePlatformAccessFailure(query.error)
  const mark = useMutation({
    mutationFn: async (publicationId: string) =>
      AnnouncementReadResultSchema.parse(
        (
          await readPlatformAnnouncement(
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
      await client.invalidateQueries({
        queryKey: platformAnnouncementKeys.inbox(user.id),
      })
    },
    onError: (error) => {
      void rejectAccess(error)
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
        "announcement-reading",
        user.id,
        announcementId,
        publicationId,
      ]),
      resolveImage: async (reference, signal) =>
        (
          await getPlatformAnnouncementInboxMedia(
            reference.fileId,
            { versionId: reference.versionId },
            { signal }
          )
        ).data,
      downloadFile: async (reference) =>
        saveAnnouncementResource(
          await getPlatformAnnouncementInboxMedia(reference.fileId, {
            versionId: reference.versionId,
          })
        ),
      getFileErrorMessage: message,
    }),
    [announcementId, publicationId, user.id]
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
export function PlatformAnnouncementReadersPage({
  announcementId,
  search,
  onSearchChange,
  onBack,
}: {
  announcementId: string
  search: { page: number; pageSize: number }
  onSearchChange: (value: { page: number; pageSize: number }) => void
  onBack: () => void
}) {
  const user = useAuthenticatedSession()!.user
  const query = useQuery({
    queryKey: [
      ...platformAnnouncementKeys.manage(user.id),
      "readers",
      announcementId,
      search,
    ],
    queryFn: async ({ signal }) =>
      AnnouncementReadersPageSchema.parse(
        (
          await listPlatformAnnouncementReaders(announcementId, search, {
            signal,
          })
        ).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  return (
    <AnnouncementReaders
      title={announcementId}
      items={query.data?.items ?? []}
      total={query.data?.total ?? 0}
      page={search.page}
      pageSize={search.pageSize}
      onPageChange={(page, pageSize) => onSearchChange({ page, pageSize })}
      onBack={onBack}
      status={getDataTableQueryStatus(query)}
      error={query.error?.message}
      onRetry={() => void query.refetch()}
    />
  )
}

export function PlatformAnnouncementPreviewPage({
  announcementId,
  onBack,
}: {
  announcementId: string
  onBack: () => void
}) {
  const user = useAuthenticatedSession()!.user
  const query = useQuery({
    queryKey: [
      ...platformAnnouncementKeys.manage(user.id),
      "preview",
      announcementId,
    ],
    queryFn: async ({ signal }) =>
      AnnouncementDetailSchema.parse(
        (await getPlatformAnnouncement(announcementId, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const version = query.data?.version
  const ports = useMemo<FileContentPorts>(
    () => ({
      contentScopeKey: JSON.stringify([
        "announcement-preview",
        user.id,
        announcementId,
        version,
      ]),
      resolveImage: async (reference, signal) =>
        (
          await getPlatformAnnouncementMedia(
            reference.fileId,
            { versionId: reference.versionId },
            { signal }
          )
        ).data,
      downloadFile: async (reference) =>
        saveAnnouncementResource(
          await getPlatformAnnouncementMedia(reference.fileId, {
            versionId: reference.versionId,
          })
        ),
      getFileErrorMessage: message,
    }),
    [announcementId, user.id, version]
  )
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    )
  return <AnnouncementArticle item={query.data} ports={ports} onBack={onBack} />
}
