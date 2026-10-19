import { useCallback, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import {
  AnnouncementInboxPageSchema,
  AnnouncementReadingSchema,
  AnnouncementReadResultSchema,
  ReadAnnouncementSchema,
  type AnnouncementInboxQuery,
  type AnnouncementReading,
} from "@workspace/contracts/platform-announcements"
import { getDataTableQueryStatus } from "@workspace/admin/data-table"
import type { FileContentPorts } from "@workspace/admin/rich-text-editor"
import type { DataTableStatus } from "@workspace/admin/data-table"

type InboxPage = z.infer<typeof AnnouncementInboxPageSchema>

export function useAnnouncementUnreadQuery(
  scope: readonly unknown[],
  list: (signal: AbortSignal) => Promise<unknown>
) {
  return useQuery({
    queryKey: [...scope, "unread"],
    queryFn: async ({ signal }) =>
      AnnouncementInboxPageSchema.parse(await list(signal)),
    retry: false,
  })
}

export function useAnnouncementInboxQuery(
  scope: readonly unknown[],
  search: AnnouncementInboxQuery,
  list: (signal: AbortSignal) => Promise<unknown>
) {
  const query = useQuery({
    queryKey: [...scope, "list", search],
    queryFn: async ({ signal }) =>
      AnnouncementInboxPageSchema.parse(await list(signal)),
    retry: false,
  })
  return {
    query,
    status: getDataTableQueryStatus(query) satisfies DataTableStatus,
  }
}

export function useAnnouncementReading(input: {
  scope: readonly unknown[]
  announcementId: string
  contentScopeKey: readonly unknown[]
  load: (signal: AbortSignal) => Promise<unknown>
  markRead: (publicationId: string) => Promise<unknown>
  invalidate: () => Promise<void>
  resolveImage: FileContentPorts["resolveImage"]
  downloadFile: FileContentPorts["downloadFile"]
  getFileErrorMessage: (error: unknown) => string
  onMarkError?: (error: unknown) => void
}) {
  const client = useQueryClient()
  const key = [...input.scope, "reading", input.announcementId] as const
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      AnnouncementReadingSchema.parse(await input.load(signal)),
    retry: false,
  })
  const mark = useMutation({
    mutationFn: async (publicationId: string) =>
      AnnouncementReadResultSchema.parse(
        await input.markRead(
          ReadAnnouncementSchema.parse({ publicationId }).publicationId
        )
      ),
    onSuccess: async () => {
      client.setQueryData(key, (previous: AnnouncementReading | undefined) =>
        previous ? { ...previous, unread: false } : previous
      )
      await input.invalidate()
    },
    onError: (error) => {
      input.onMarkError?.(error)
    },
  })
  const publicationId = query.data?.publicationId
  const scopeKey = JSON.stringify(input.contentScopeKey)
  const mutate = mark.mutate
  const onMarkRead = useCallback(() => {
    mutate(z.uuid().parse(publicationId))
  }, [mutate, publicationId])
  const ports = useMemo<FileContentPorts>(
    () => ({
      contentScopeKey: JSON.stringify([
        ...(JSON.parse(scopeKey) as unknown[]),
        publicationId,
      ]),
      resolveImage: input.resolveImage,
      downloadFile: input.downloadFile,
      getFileErrorMessage: input.getFileErrorMessage,
    }),
    [
      scopeKey,
      input.downloadFile,
      input.getFileErrorMessage,
      input.resolveImage,
      publicationId,
    ]
  )
  return {
    query,
    ports,
    onMarkRead,
    markingRead: mark.isPending,
    readFailed: mark.isError,
  }
}

export type { InboxPage }
