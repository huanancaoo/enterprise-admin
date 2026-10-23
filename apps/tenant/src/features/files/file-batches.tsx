import type { ReactNode } from "react"
import {
  FileBatches as SharedFileBatches,
  type FileBatchAdapter,
} from "@workspace/admin/files"
import type { FileEntryResponse, FolderResponse } from "@workspace/contracts"
import { fileKeys } from "./file-queries"
import { createFileBatchPorts } from "./use-file-batch"
import {
  getFileEntry,
  getFileEntryImpact,
  requestLanguageHeader,
} from "@workspace/api-client"
import { useUiLocale } from "@workspace/i18n/react"
import { BatchActionsContext } from "./batch-context"
import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import { canPerformFileAction, type FilePermissions } from "./file-permissions"

export function FileBatches({
  userId,
  organizationId,
  authorizationVersion,
  contentScopeKey,
  root,
  permissions,
  children,
}: {
  userId: string
  organizationId: string
  authorizationVersion: number
  contentScopeKey: string
  root: FolderResponse
  permissions?: FilePermissions
  children: ReactNode
}) {
  const locale = useUiLocale()
  const adapter: FileBatchAdapter<FileEntryResponse> = {
    recordScopeKey: JSON.stringify([userId, organizationId]),
    queryKey: fileKeys.scope(organizationId),
    ports: createFileBatchPorts(organizationId, locale),
    canAct: (entry, action) =>
      canPerformFileAction(entry, action, organizationId, permissions),
    readEntry: async (id, signal) =>
      (
        await getFileEntry(organizationId, id, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    readImpact: async (id, action, signal) =>
      (
        await getFileEntryImpact(
          organizationId,
          id,
          { action },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
  }
  return (
    <SharedFileBatches
      ActionsContext={BatchActionsContext}
      key={contentScopeKey}
      adapter={adapter}
      contentScopeKey={contentScopeKey}
      permissions={permissions}
      renderFolderPicker={(picker) => (
        <ConnectedFolderPickerDialog
          {...picker}
          organizationId={organizationId}
          authorizationVersion={authorizationVersion}
          root={root}
          contentScopeKey={contentScopeKey}
        />
      )}
    >
      {children}
    </SharedFileBatches>
  )
}
