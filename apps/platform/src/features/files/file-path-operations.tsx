import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import { type FileScope } from "./queries"
import type { FolderView as FolderResponse } from "@workspace/admin/files"
import type { FileEntryView as FileEntryResponse } from "@workspace/admin/files"
import type { ReactNode } from "react"
import {
  getPlatformFileEntry,
  getPlatformFileEntryImpact,
  getPlatformFileOperation,
  renamePlatformFileEntry,
  movePlatformFileEntry,
  trashPlatformFileEntry,
  restorePlatformFileEntry,
  purgePlatformFileEntry,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  RenameFileEntry,
  MoveFileEntry,
  TrashFileEntry,
  RestoreFileEntry,
  PurgeFileEntry,
  FileOperationResponse,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { FileReferenceLocations } from "./file-reference-locations"
import {
  canPerformFileAction,
  canShowFileAction,
  type FilePermissions,
} from "./file-permissions"
import { PathActionsContext } from "./path-context"
import {
  FilePathOperations as SharedFilePathOperations,
  type FilePathAdapter,
} from "@workspace/admin/files"

export function FilePathOperations({
  userId,
  scope,
  contentScopeKey,
  root,
  permissions,
  children,
  onCompleted,
}: {
  userId: string
  scope: FileScope
  contentScopeKey: string
  root: FolderResponse
  permissions?: FilePermissions
  children: ReactNode
  onCompleted?: (operation: FileOperationResponse) => void
}) {
  const locale = useUiLocale()
  const adapter: FilePathAdapter<FileEntryResponse> = {
    userId,
    ownerKey: "platform",
    queryKey: scope.key,
    canShow: (entry, action) =>
      canShowFileAction(entry, action, scope, permissions),
    canPerform: (entry, action) =>
      canPerformFileAction(entry, action, scope, permissions),
    submit: async (action, entryId, body, signal) => {
      const options = { signal, headers: { [requestLanguageHeader]: locale } }
      // action 与 body 由同一命令的契约生成，不持久化或重放这份写入正文。
      switch (action) {
        case "rename":
          return (
            await renamePlatformFileEntry(
              entryId,
              body as RenameFileEntry,
              options
            )
          ).data
        case "move":
          return (
            await movePlatformFileEntry(entryId, body as MoveFileEntry, options)
          ).data
        case "trash":
          return (
            await trashPlatformFileEntry(
              entryId,
              body as TrashFileEntry,
              options
            )
          ).data
        case "restore":
          return (
            await restorePlatformFileEntry(
              entryId,
              body as RestoreFileEntry,
              options
            )
          ).data
        case "purge":
          return (
            await purgePlatformFileEntry(
              entryId,
              body as PurgeFileEntry,
              options
            )
          ).data
      }
    },
    readOperation: async (id, signal) =>
      (
        await getPlatformFileOperation(id, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
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
    <SharedFilePathOperations
      ActionsContext={PathActionsContext}
      key={contentScopeKey}
      adapter={adapter}
      contentScopeKey={contentScopeKey}
      root={root}
      onCompleted={onCompleted}
      renderFolderPicker={(picker) => (
        <ConnectedFolderPickerDialog
          {...picker}
          scope={scope}
          root={root}
          contentScopeKey={contentScopeKey}
        />
      )}
      renderReferences={(entry) => (
        <FileReferenceLocations scope={scope} entryId={entry.id} />
      )}
    >
      {children}
    </SharedFilePathOperations>
  )
}
