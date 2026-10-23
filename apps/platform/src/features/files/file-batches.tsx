import type { ReactNode } from "react"
import {
  FileBatches as SharedFileBatches,
  type FileBatchAdapter,
} from "@workspace/admin/files"
import type {
  FileEntryView as FileEntryResponse,
  FolderView as FolderResponse,
} from "@workspace/admin/files"
import { createFileBatchPorts, type FileScope } from "./queries"
import {
  getPlatformFileEntry,
  getPlatformFileEntryImpact,
  requestLanguageHeader,
} from "@workspace/api-client"
import { useUiLocale } from "@workspace/i18n/react"
import { BatchActionsContext } from "./batch-context"
import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import { canPerformFileAction, type FilePermissions } from "./file-permissions"

export function FileBatches({
  userId,
  scope,
  contentScopeKey,
  root,
  permissions,
  children,
}: {
  userId: string
  scope: FileScope
  contentScopeKey: string
  root: FolderResponse
  permissions?: FilePermissions
  children: ReactNode
}) {
  const locale = useUiLocale()
  const adapter: FileBatchAdapter<FileEntryResponse> = {
    recordScopeKey: JSON.stringify([userId, "platform"]),
    queryKey: scope.key,
    ports: createFileBatchPorts(locale),
    canAct: (entry, action) =>
      canPerformFileAction(entry, action, scope, permissions),
    readEntry: async (id, signal) =>
      (
        await getPlatformFileEntry(id, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    readImpact: async (id, action, signal) =>
      (
        await getPlatformFileEntryImpact(
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
          scope={scope}
          root={root}
          contentScopeKey={contentScopeKey}
        />
      )}
    >
      {children}
    </SharedFileBatches>
  )
}
