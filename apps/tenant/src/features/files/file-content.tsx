import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  getFileVersionContent,
  getGetFileVersionContentUrl,
  organizationKeys,
  requestLanguageHeader,
} from "@workspace/api-client"
import type { FileResponse, FileVersionResponse } from "@workspace/contracts"
import {
  FileDownloadButton as Download,
  ProtectedFilePreview as Preview,
  type FileContentAccess,
} from "@workspace/admin/files"
import { downloadProtectedFile } from "./protected-file-download"
import { fileRequestErrorMessage, fileRequestIsDenied } from "./file-queries"
export type FileContentTarget = {
  file: Pick<FileResponse, "id" | "organizationId" | "name">
  version: FileVersionResponse
}
function useAccess(organizationId: string) {
  const client = useQueryClient()
  return useMemo<FileContentAccess>(
    () => ({
      read: (target, disposition, signal, locale, range) =>
        getFileVersionContent(
          organizationId,
          target.file.id,
          target.version.id,
          { disposition },
          range ? { Range: range } : undefined,
          { signal, headers: { [requestLanguageHeader]: locale } }
        ),
      url: (target) =>
        getGetFileVersionContentUrl(
          organizationId,
          target.file.id,
          target.version.id,
          { disposition: "inline" }
        ),
      download: (target, signal, locale) =>
        downloadProtectedFile(
          organizationId,
          { fileId: target.file.id, versionId: target.version.id },
          signal,
          locale
        ),
      onError: (error) => {
        if (fileRequestIsDenied(error))
          void client.invalidateQueries({
            queryKey: organizationKeys.access(organizationId),
          })
      },
      errorMessage: fileRequestErrorMessage,
    }),
    [client, organizationId]
  )
}
export function FileDownloadButton({ target }: { target: FileContentTarget }) {
  return (
    <Download target={target} access={useAccess(target.file.organizationId)} />
  )
}
export function ProtectedFilePreview({
  target,
  contentScopeKey,
}: {
  target: FileContentTarget
  contentScopeKey: string
}) {
  return (
    <Preview
      target={target}
      contentScopeKey={contentScopeKey}
      access={useAccess(target.file.organizationId)}
    />
  )
}
