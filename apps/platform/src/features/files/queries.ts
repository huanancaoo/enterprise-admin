import { useMemo } from "react"
import { queryOptions, type UseQueryOptions } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  type FileContentAccess,
  fileRequestErrorMessage,
} from "@workspace/admin/files"
import {
  getPlatformFileWorkspace,
  listPlatformFileEntries,
  getPlatformFileBreadcrumbs,
  getPlatformFileEntry,
  listPlatformFileVersions,
  getPlatformFileReferences,
  getPlatformFileOperation,
  getPlatformFileVersionContent,
  getGetPlatformFileVersionContentUrl,
  requestLanguageHeader,
} from "@workspace/api-client"
import {
  PlatformFileWorkspaceSchema,
  PlatformFilePageSchema,
  PlatformFileBreadcrumbsSchema,
  PlatformFileEntrySchema,
  FileVersionsSchema,
  PlatformFileReferencesSchema,
  FileOperationResponseSchema,
  type FileListQuery,
  type SupportedLocale,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { saveAnnouncementResource } from "@workspace/announcements"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

export function useFileScope() {
  const user = useAuthenticatedSession()!.user
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const locale = useUiLocale()
  const key = JSON.stringify(platformAccess.permissions)
  return useMemo(
    () => ({
      userId: user.id,
      locale,
      permissions: platformAccess.permissions,
      contentKey: JSON.stringify([user.id, key]),
      key: ["platform", user.id, "files", key, locale] as const,
    }),
    [user.id, locale, key, platformAccess.permissions]
  )
}
export type FileScope = ReturnType<typeof useFileScope>
const request = (signal: AbortSignal, locale: SupportedLocale) => ({
  signal,
  headers: { [requestLanguageHeader]: locale },
})
export const workspaceOptions = (scope: FileScope) =>
  queryOptions({
    queryKey: [...scope.key, "workspace"],
    queryFn: async ({ signal }) =>
      PlatformFileWorkspaceSchema.parse(
        (await getPlatformFileWorkspace(request(signal, scope.locale))).data
      ),
    retry: false,
  })
export const entriesOptions = (scope: FileScope, search: FileListQuery) =>
  queryOptions({
    queryKey: [...scope.key, "entries", search],
    queryFn: async ({ signal }) =>
      PlatformFilePageSchema.parse(
        (await listPlatformFileEntries(search, request(signal, scope.locale)))
          .data
      ),
    retry: false,
  })
export const breadcrumbOptions = (scope: FileScope, id: string) =>
  queryOptions({
    queryKey: [...scope.key, "breadcrumbs", id],
    queryFn: async ({ signal }) =>
      PlatformFileBreadcrumbsSchema.parse(
        (await getPlatformFileBreadcrumbs(id, request(signal, scope.locale)))
          .data
      ),
    retry: false,
  })
export const entryOptions = (scope: FileScope, id: string) =>
  queryOptions({
    queryKey: [...scope.key, "entry", id],
    queryFn: async ({ signal }) =>
      PlatformFileEntrySchema.parse(
        (await getPlatformFileEntry(id, request(signal, scope.locale))).data
      ),
    retry: false,
  })
export const versionsOptions = (scope: FileScope, id: string) =>
  queryOptions({
    queryKey: [...scope.key, "versions", id],
    queryFn: async ({ signal }) =>
      FileVersionsSchema.parse(
        (await listPlatformFileVersions(id, request(signal, scope.locale))).data
      ),
    retry: false,
  })
export const referencesOptions = (scope: FileScope, id: string) =>
  queryOptions({
    queryKey: [...scope.key, "references", id],
    queryFn: async ({ signal }) =>
      PlatformFileReferencesSchema.parse(
        (await getPlatformFileReferences(id, request(signal, scope.locale)))
          .data
      ),
    retry: false,
  })
export const folderChildrenOptions = (
  scope: FileScope,
  id: string
): UseQueryOptions<
  Extract<
    ReturnType<typeof PlatformFileEntrySchema.parse>,
    { kind: "folder" }
  >[]
> => ({
  queryKey: [...scope.key, "children", id],
  queryFn: async ({ signal }) => {
    const items: Extract<
      ReturnType<typeof PlatformFileEntrySchema.parse>,
      { kind: "folder" }
    >[] = []
    for (let page = 1; ; page++) {
      const result = PlatformFilePageSchema.parse(
        (
          await listPlatformFileEntries(
            {
              parentId: id,
              state: "active",
              page,
              pageSize: 100,
              sortBy: "name",
              sortOrder: "asc",
            },
            request(signal, scope.locale)
          )
        ).data
      )
      items.push(...result.items.filter((entry) => entry.kind === "folder"))
      if (page * result.pageSize >= result.total) return items
    }
  },
  retry: false,
})
export const readOperation = async (id: string, signal: AbortSignal) =>
  FileOperationResponseSchema.parse(
    (await getPlatformFileOperation(id, { signal })).data
  )
export function useFileContentAccess(): FileContentAccess {
  const reject = usePlatformAccessFailure()
  return useMemo<FileContentAccess>(
    () => ({
      read: (target, disposition, signal, locale, range) =>
        getPlatformFileVersionContent(
          target.file.id,
          target.version.id,
          { disposition },
          range ? { Range: range } : undefined,
          request(signal, locale)
        ),
      url: (target) =>
        getGetPlatformFileVersionContentUrl(target.file.id, target.version.id, {
          disposition: "inline",
        }),
      download: async (target, signal, locale) => {
        const response = await getPlatformFileVersionContent(
          target.file.id,
          target.version.id,
          { disposition: "attachment" },
          undefined,
          request(signal, locale)
        )
        signal.throwIfAborted()
        saveAnnouncementResource(response)
      },
      errorMessage: fileRequestErrorMessage,
      onError: (error) => {
        void reject(error)
      },
    }),
    [reject]
  )
}
export {
  fileRequestErrorMessage,
  fileRequestIsDenied,
} from "@workspace/admin/files"
export { createFileBatchPorts } from "./batch-ports"
export const trashBreadcrumbOptions = (
  scope: FileScope,
  search: FileListQuery,
  root: ReturnType<typeof PlatformFileWorkspaceSchema.parse>["root"]
) =>
  queryOptions({
    queryKey: [
      ...scope.key,
      "breadcrumbs",
      search.state,
      search.parentId ?? root.id,
    ],
    retry: false,
    queryFn: async ({ signal }) => {
      if (search.state === "trashed" && !search.parentId)
        return { items: [root] }
      const result = PlatformFileBreadcrumbsSchema.parse(
        (
          await getPlatformFileBreadcrumbs(
            search.parentId ?? root.id,
            request(signal, scope.locale)
          )
        ).data
      )
      return search.state === "trashed"
        ? {
            items: [
              root,
              ...result.items.filter((folder) => folder.state === "trashed"),
            ],
          }
        : result
    },
  })
