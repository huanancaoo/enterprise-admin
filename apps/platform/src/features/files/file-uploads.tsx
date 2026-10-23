import type { ReactNode } from "react"
import {
  FileUploads as SharedFileUploads,
  type FileUploadAdapter,
} from "@workspace/admin/files"
import {
  getPlatformFileEntry,
  getPlatformFileOperation,
  overwritePlatformFile,
  uploadPlatformFile,
  requestLanguageHeader,
} from "@workspace/api-client"
import type { FileVersionReference } from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { UploadActionsContext } from "./upload-context"
import type { FileScope } from "./queries"
type FileUploadsProps = {
  userId: string
  scope: FileScope
  contentScopeKey: string
  canUpload: boolean
  canOverwrite: boolean
  onOpenVersion: (reference: FileVersionReference) => void
  children: ReactNode
}

export function FileUploads({
  userId,
  scope,
  contentScopeKey,
  canUpload,
  canOverwrite,
  onOpenVersion,
  children,
}: FileUploadsProps) {
  const locale = useUiLocale()
  const adapter: FileUploadAdapter = {
    userId,
    ownerKey: "platform",
    upload: async (fields, file, signal) =>
      (
        await uploadPlatformFile(
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    overwrite: async (fileId, fields, file, signal) =>
      (
        await overwritePlatformFile(
          fileId,
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    readOperation: async (operationId, signal) =>
      (
        await getPlatformFileOperation(operationId, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    readEntry: async (id, signal) =>
      (
        await getPlatformFileEntry(id, {
          signal: signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    completedQueryKeys: [
      "entries",
      "breadcrumbs",
      "workspace",
      "entry",
      "versions",
    ].map((resource) => [...scope.key, resource]),
  }
  return (
    <SharedFileUploads
      ActionsContext={UploadActionsContext}
      key={contentScopeKey}
      adapter={adapter}
      contentScopeKey={contentScopeKey}
      canUpload={canUpload}
      canOverwrite={canOverwrite}
      onOpenVersion={onOpenVersion}
    >
      {children}
    </SharedFileUploads>
  )
}
