import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { FileListQuerySchema } from "@workspace/contracts/files"
import type {
  FileBrowserProps,
  FolderView as FolderResponse,
} from "@workspace/admin/files"
import {
  type FileScope,
  fileRequestErrorMessage,
  fileRequestIsDenied,
  breadcrumbOptions,
  entriesOptions,
} from "./queries"
export type PickerContext = {
  scope: FileScope
  contentScopeKey: string
  root: FolderResponse
  initialFolderId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function usePickerBrowser({
  scope,
  contentScopeKey,
  root,
  initialFolderId,
}: PickerContext) {
  const { t } = useTranslation("common")
  const [search, setSearch] = useState(() =>
    FileListQuerySchema.parse({ parentId: initialFolderId ?? root.id })
  )
  const parentId = search.parentId!
  const breadcrumbs = useQuery(breadcrumbOptions(scope, parentId))
  const entries = useQuery(entriesOptions(scope, search))
  const error = breadcrumbs.error ?? entries.error
  const denied =
    fileRequestIsDenied(breadcrumbs.error) || fileRequestIsDenied(entries.error)
  const loading = breadcrumbs.isPending || entries.isPending
  const refreshing = breadcrumbs.isFetching || entries.isFetching
  const browser: Omit<FileBrowserProps, "onOpenFile"> = {
    contentScopeKey,
    // 根目录只作为查询期间的浏览外壳；当前路径未读回前不能确认任何选择。
    currentFolder: breadcrumbs.data?.items.at(-1) ?? root,
    breadcrumbs: breadcrumbs.data ?? { items: [root] },
    page: entries.data,
    search,
    status: denied
      ? "forbidden"
      : error
        ? "error"
        : loading
          ? "loading"
          : refreshing
            ? "refreshing"
            : "ready",
    error: error
      ? fileRequestErrorMessage(error, t("operationFailed"))
      : undefined,
    onRetry: () => {
      void Promise.all([breadcrumbs.refetch(), entries.refetch()])
    },
    onSearchChange: setSearch,
    onOpenFolder: (folder) =>
      setSearch((current) => ({
        ...current,
        parentId: folder.id,
        name: undefined,
        page: 1,
      })),
    onLocate: (entry) =>
      setSearch((current) => ({
        ...current,
        parentId: entry.parentId ?? root.id,
        name: undefined,
        page: 1,
      })),
  }
  return browser
}
