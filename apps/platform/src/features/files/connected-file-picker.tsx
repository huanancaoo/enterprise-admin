import { usePickerBrowser, type PickerContext } from "./use-picker-browser"
import type { FolderView as FolderResponse } from "@workspace/admin/files"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { type FileVersionReference } from "@workspace/contracts/files"
import { FilePickerDialog, FolderPickerDialog } from "@workspace/admin/files"
import { fileRequestErrorMessage } from "./queries"

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
