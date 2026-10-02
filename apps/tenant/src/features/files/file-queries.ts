import { queryOptions } from "@tanstack/react-query"
import {
  ApiClientError,
  getFileWorkspace,
  listFileEntries,
  getFileEntry,
  getFileBreadcrumbs,
  listFileVersions,
  getFileOperation,
  getFileReferenceLocations,
  organizationKeys,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileBreadcrumbs,
  FileEntryResponse,
  FileListQuery,
  FileOperationResponse,
  FilePage,
  FileVersions,
  FileWorkspace,
  FileReferenceLocations,
  FolderResponse,
  SupportedLocale,
} from "@workspace/contracts"

export function fileRequestErrorMessage(error: unknown, generic: string) {
  return error instanceof ApiClientError ? error.body.message : generic
}

export function fileRequestIsDenied(error: unknown) {
  return error instanceof ApiClientError && error.status === 403
}

export const fileKeys = {
  scope: (organizationId: string) =>
    [...organizationKeys.scope(organizationId), "files"] as const,
}

function requestOptions(signal: AbortSignal, locale: SupportedLocale) {
  return { signal, headers: { [requestLanguageHeader]: locale } }
}

export function getFileWorkspaceOptions(
  organizationId: string,
  authorizationVersion: number,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "workspace",
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileWorkspace> =>
      (await getFileWorkspace(organizationId, requestOptions(signal, locale)))
        .data,
  })
}

export function getFileReferenceLocationsOptions(
  organizationId: string,
  authorizationVersion: number,
  entryId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "references",
      entryId,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileReferenceLocations> =>
      (
        await getFileReferenceLocations(
          organizationId,
          entryId,
          requestOptions(signal, locale)
        )
      ).data,
  })
}

export function getFileEntriesOptions(
  organizationId: string,
  authorizationVersion: number,
  search: FileListQuery,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "list",
      search,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FilePage> =>
      (
        await listFileEntries(
          organizationId,
          search,
          requestOptions(signal, locale)
        )
      ).data,
  })
}

export function getFileBreadcrumbsOptions(
  organizationId: string,
  authorizationVersion: number,
  folderId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "breadcrumbs",
      folderId,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileBreadcrumbs> =>
      (
        await getFileBreadcrumbs(
          organizationId,
          folderId,
          requestOptions(signal, locale)
        )
      ).data,
  })
}

export function getFileTrashBreadcrumbsOptions(
  organizationId: string,
  authorizationVersion: number,
  folderId: string | undefined,
  root: FolderResponse,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "breadcrumbs",
      "trashed",
      folderId ?? root.id,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileBreadcrumbs> => {
      const folders: FolderResponse[] = []
      let id: string | null | undefined = folderId
      // 回收站不查询有效目录面包屑，也不从 path 文本猜测目录身份。
      while (id) {
        const entry: FileEntryResponse = (
          await getFileEntry(organizationId, id, requestOptions(signal, locale))
        ).data
        if (entry.kind !== "folder" || entry.state !== "trashed") {
          if (!folders.length) throw new Error("Trash folder is unavailable")
          break
        }
        folders.unshift(entry)
        id = entry.parentId
      }
      return { items: [root, ...folders] }
    },
  })
}

export function getFileEntryOptions(
  organizationId: string,
  authorizationVersion: number,
  entryId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "entry",
      entryId,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileEntryResponse> =>
      (
        await getFileEntry(
          organizationId,
          entryId,
          requestOptions(signal, locale)
        )
      ).data,
  })
}

export function getFileVersionsOptions(
  organizationId: string,
  authorizationVersion: number,
  fileId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "versions",
      fileId,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileVersions> =>
      (
        await listFileVersions(
          organizationId,
          fileId,
          requestOptions(signal, locale)
        )
      ).data,
  })
}

export function getFileOperationOptions(
  organizationId: string,
  authorizationVersion: number,
  operationId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      "operation",
      operationId,
      locale,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FileOperationResponse> =>
      (
        await getFileOperation(
          organizationId,
          operationId,
          requestOptions(signal, locale)
        )
      ).data,
    refetchInterval: (query) => {
      if (query.state.error) return false
      const phase = query.state.data?.phase
      return phase && phase !== "completed" && phase !== "failed" ? 1500 : false
    },
  })
}
