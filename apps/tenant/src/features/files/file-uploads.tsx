import type { ReactNode } from "react"
import {
  FileUploads as SharedFileUploads,
  type FileUploadAdapter,
} from "@workspace/admin/files"
import {
  getFileEntry,
  getFileOperation,
  overwriteOrganizationFile,
  uploadOrganizationFile,
  requestLanguageHeader,
} from "@workspace/api-client"
import type { FileVersionReference } from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { UploadActionsContext } from "./upload-context"
import { fileKeys } from "./file-queries"
type FileUploadsProps = {
  userId: string
  organizationId: string
  authorizationVersion: number
  contentScopeKey: string
  canUpload: boolean
  canOverwrite: boolean
  onOpenVersion: (reference: FileVersionReference) => void
  children: ReactNode
}

export function FileUploads({
  userId,
  organizationId,
  authorizationVersion,
  contentScopeKey,
  canUpload,
  canOverwrite,
  onOpenVersion,
  children,
}: FileUploadsProps) {
  const locale = useUiLocale()
  const adapter: FileUploadAdapter = {
    userId,
    ownerKey: organizationId,
    upload: async (fields, file, signal) =>
      (
        await uploadOrganizationFile(
          organizationId,
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    overwrite: async (fileId, fields, file, signal) =>
      (
        await overwriteOrganizationFile(
          organizationId,
          fileId,
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    readOperation: async (operationId, signal) =>
      (
        await getFileOperation(organizationId, operationId, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    readEntry: async (id, signal) =>
      (
        await getFileEntry(organizationId, id, {
          signal: signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    completedQueryKeys: [
      "list",
      "breadcrumbs",
      "workspace",
      "entry",
      "versions",
    ].map((resource) => [
      ...fileKeys.scope(organizationId),
      authorizationVersion,
      resource,
    ]),
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
