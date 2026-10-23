import { useAnnouncementFilePicker } from "../files/use-announcement-file-picker"
import { useFileScope } from "../files/queries"
import { filePermissions } from "../files/file-permissions"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import {
  AdminPage,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { getDataTableQueryStatus } from "@workspace/admin/data-table"
import type { FileContentPorts } from "@workspace/admin/rich-text-editor"
import {
  AnnouncementArticle,
  AnnouncementEntry,
  AnnouncementInbox,
  saveAnnouncementResource,
  useAnnouncementInboxQuery,
  useAnnouncementReading,
  useAnnouncementUnreadQuery,
  type AnnouncementInboxSearch,
} from "@workspace/announcements"
import {
  ApiClientError,
  createPlatformAnnouncement,
  deletePlatformAnnouncement,
  getPlatformAnnouncement,
  getPlatformAnnouncementInboxMedia,
  getPlatformAnnouncementMedia,
  getPlatformAnnouncementReading,
  listPlatformAnnouncementInbox,
  listPlatformAnnouncementReaders,
  listPlatformAnnouncements,
  publishPlatformAnnouncement,
  readPlatformAnnouncement,
  updatePlatformAnnouncement,
  uploadPlatformAnnouncementMedia,
  withdrawPlatformAnnouncement,
} from "@workspace/api-client"
import {
  AnnouncementAttachmentSchema,
  AnnouncementDetailSchema,
  AnnouncementPageSchema,
  AnnouncementReadersPageSchema,
  AnnouncementRichTextDocumentSchema,
  AnnouncementVersionSchema,
  CreateAnnouncementSchema,
  PublishAnnouncementSchema,
  ReadAnnouncementSchema,
  UpdateAnnouncementSchema,
} from "@workspace/contracts/platform-announcements"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import {
  AnnouncementEditor,
  type AnnouncementDraftValue,
} from "./announcement-editor"
import {
  AnnouncementList,
  type AnnouncementManagementSearch,
} from "./announcement-list"
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
  const { t } = useTranslation("announcements")

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
  if (!canEdit)
    return (
      <AdminPage title={t("edit")}>
        <PermissionDeniedState />
      </AdminPage>
    )
  if (announcementId && query.isPending)
    return (
      <AdminPage title={t("edit")}>
        <LoadingState />
      </AdminPage>
    )
  if (
    query.isError &&
    (!query.data ||
      (query.error instanceof ApiClientError &&
        [401, 403].includes(query.error.status)))
  )
    return (
      <AdminPage title={t("edit")}>
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </AdminPage>
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
  const picker = useAnnouncementFilePicker(),
    permissions = filePermissions(useFileScope())
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
    return (
      <AdminPage title={t("edit")}>
        <ErrorState message={t("batchHint")} onRetry={onBack} />
      </AdminPage>
    )
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
    <>
      <AnnouncementEditor
        mode={detail ? "edit" : "create"}
        initialValue={initialValue}
        ports={ports}
        onPickImage={
          permissions.canReadFiles && permissions.canReadFolders
            ? async (signal) => {
                const file = await picker.pick("image", signal)
                return file
                  ? { fileId: file.fileId, versionId: file.versionId }
                  : null
              }
            : undefined
        }
        onPickAttachment={
          permissions.canReadFiles && permissions.canReadFolders
            ? (signal) => picker.pick("attachment", signal)
            : undefined
        }
        onUploadImage={
          permissions.canUpload
            ? async (file, options) => {
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
              }
            : undefined
        }
        onUploadAttachment={
          permissions.canUpload
            ? async (file, signal) =>
                AnnouncementAttachmentSchema.parse(
                  (await uploadPlatformAnnouncementMedia({ file }, { signal }))
                    .data
                )
            : undefined
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
      {picker.dialog}
    </>
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
  const { query, status } = useAnnouncementInboxQuery(
    platformAnnouncementKeys.inbox(user.id),
    search,
    (signal) =>
      listPlatformAnnouncementInbox(search, { signal }).then(
        (reply) => reply.data
      )
  )
  usePlatformAccessFailure(query.error)
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
export function PlatformAnnouncementEntry({ onOpen }: { onOpen: () => void }) {
  const user = useAuthenticatedSession()!.user
  const query = useAnnouncementUnreadQuery(
    platformAnnouncementKeys.inbox(user.id),
    (signal) =>
      listPlatformAnnouncementInbox({ page: 1, pageSize: 1 }, { signal }).then(
        (reply) => reply.data
      )
  )
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
  const rejectAccess = usePlatformAccessFailure(undefined)
  const reading = useAnnouncementReading({
    scope: platformAnnouncementKeys.inbox(user.id),
    announcementId,
    contentScopeKey: ["announcement-reading", user.id, announcementId],
    load: (signal) =>
      getPlatformAnnouncementReading(announcementId, { signal }).then(
        (reply) => reply.data
      ),
    markRead: (publicationId) =>
      readPlatformAnnouncement(
        announcementId,
        ReadAnnouncementSchema.parse({ publicationId })
      ).then((reply) => reply.data),
    invalidate: () =>
      client.invalidateQueries({
        queryKey: platformAnnouncementKeys.inbox(user.id),
      }),
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
    onMarkError: (error) => {
      void rejectAccess(error)
    },
  })
  usePlatformAccessFailure(reading.query.error)
  if (reading.query.isPending)
    return (
      <AdminPage title={t("title")}>
        <LoadingState />
      </AdminPage>
    )
  if (reading.query.isError)
    return (
      <AdminPage title={t("title")}>
        <ErrorState
          message={reading.query.error.message}
          onRetry={() => void reading.query.refetch()}
        />
      </AdminPage>
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
  const { t } = useTranslation("announcements")

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
  if (query.isPending)
    return (
      <AdminPage title={t("title")}>
        <LoadingState />
      </AdminPage>
    )
  if (query.isError)
    return (
      <AdminPage title={t("title")}>
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </AdminPage>
    )
  return <AnnouncementArticle item={query.data} ports={ports} onBack={onBack} />
}
