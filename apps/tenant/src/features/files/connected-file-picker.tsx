import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  FileListQuerySchema,
  type FileVersionReference,
  type FolderResponse,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import type { FileBrowserProps } from "./file-browser"
import { FilePickerDialog, FolderPickerDialog } from "./file-picker"
import {
  fileRequestErrorMessage,
  fileRequestIsDenied,
  getFileBreadcrumbsOptions,
  getFileEntriesOptions,
} from "./file-queries"

type PickerContext = {
  organizationId: string
  authorizationVersion: number
  contentScopeKey: string
  root: FolderResponse
  initialFolderId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type FilePickerProps = PickerContext & {
  allowedContentTypes?: readonly string[]
  uploadControl?: ReactNode | ((currentFolder: FolderResponse) => ReactNode)
  onPick: (
    reference: FileVersionReference,
    signal: AbortSignal
  ) => Promise<void>
}

type FolderPickerProps = PickerContext & {
  canPick: (folder: FolderResponse) => boolean
  onPick: (folder: FolderResponse, signal: AbortSignal) => Promise<void>
}

function usePickerBrowser({
  organizationId,
  authorizationVersion,
  contentScopeKey,
  root,
  initialFolderId,
}: PickerContext) {
  const { t } = useTranslation("common")
  const locale = useUiLocale()
  const [search, setSearch] = useState(() =>
    FileListQuerySchema.parse({ parentId: initialFolderId ?? root.id })
  )
  const parentId = search.parentId!
  const breadcrumbs = useQuery(
    getFileBreadcrumbsOptions(
      organizationId,
      authorizationVersion,
      parentId,
      locale
    )
  )
  const entries = useQuery(
    getFileEntriesOptions(organizationId, authorizationVersion, search, locale)
  )
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

export function ConnectedFilePickerDialog(props: FilePickerProps) {
  return props.open ? (
    <ConnectedFilePicker
      key={JSON.stringify([props.contentScopeKey, props.initialFolderId])}
      {...props}
    />
  ) : null
}

function ConnectedFilePicker(props: FilePickerProps) {
  const { t } = useTranslation("common")
  const browser = usePickerBrowser(props)
  return (
    <FilePickerDialog
      open
      browser={browser}
      onOpenChange={props.onOpenChange}
      allowedContentTypes={props.allowedContentTypes}
      // 上传必须使用已读回的当前文件夹，查询期间的根目录外壳不能成为上传目标。
      uploadControl={
        browser.status === "ready"
          ? typeof props.uploadControl === "function"
            ? props.uploadControl(browser.currentFolder)
            : props.uploadControl
          : undefined
      }
      onPick={props.onPick}
      getErrorMessage={(error) =>
        fileRequestErrorMessage(error, t("operationFailed"))
      }
    />
  )
}

export function ConnectedFolderPickerDialog(props: FolderPickerProps) {
  return props.open ? (
    <ConnectedFolderPicker
      key={JSON.stringify([props.contentScopeKey, props.initialFolderId])}
      {...props}
    />
  ) : null
}

function ConnectedFolderPicker(props: FolderPickerProps) {
  const { t } = useTranslation("common")
  const browser = usePickerBrowser(props)
  return (
    <FolderPickerDialog
      open
      browser={browser}
      onOpenChange={props.onOpenChange}
      canPick={props.canPick}
      onPick={props.onPick}
      getErrorMessage={(error) =>
        fileRequestErrorMessage(error, t("operationFailed"))
      }
    />
  )
}
