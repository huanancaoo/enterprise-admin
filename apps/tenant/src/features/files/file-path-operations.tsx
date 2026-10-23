import type { ReactNode } from "react"
import {
  getFileEntry,
  getFileEntryImpact,
  getFileOperation,
  renameFileEntry,
  moveFileEntry,
  trashFileEntry,
  restoreFileEntry,
  purgeFileEntry,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileEntryResponse,
  FolderResponse,
  RenameFileEntry,
  MoveFileEntry,
  TrashFileEntry,
  RestoreFileEntry,
  PurgeFileEntry,
  FileOperationResponse,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { FileReferenceLocations } from "./file-reference-locations"
import { fileKeys } from "./file-queries"
import {
  canPerformFileAction,
  canShowFileAction,
  type FilePermissions,
} from "./file-permissions"
import { PathActionsContext } from "./path-context"

import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import {
  FilePathOperations as SharedFilePathOperations,
  type FilePathAdapter,
} from "@workspace/admin/files"
export function FilePathOperations({
  userId,
  organizationId,
  authorizationVersion,
  contentScopeKey,
  root,
  permissions,
  children,
  onCompleted,
}: {
  userId: string
  organizationId: string
  authorizationVersion: number
  contentScopeKey: string
  root: FolderResponse
  permissions?: FilePermissions
  children: ReactNode
  onCompleted?: (operation: FileOperationResponse) => void
}) {
  const locale = useUiLocale()
  const adapter: FilePathAdapter<FileEntryResponse> = {
    userId,
    ownerKey: organizationId,
    queryKey: fileKeys.scope(organizationId),
    canShow: (entry, action) =>
      canShowFileAction(entry, action, organizationId, permissions),
    canPerform: (entry, action) =>
      canPerformFileAction(entry, action, organizationId, permissions),
    submit: async (action, entryId, body, signal) => {
      const options = { signal, headers: { [requestLanguageHeader]: locale } }
      // action 与 body 由同一命令的契约生成，不持久化或重放这份写入正文。
      switch (action) {
        case "rename":
          return (
            await renameFileEntry(
              organizationId,
              entryId,
              body as RenameFileEntry,
              options
            )
          ).data
        case "move":
          return (
            await moveFileEntry(
              organizationId,
              entryId,
              body as MoveFileEntry,
              options
            )
          ).data
        case "trash":
          return (
            await trashFileEntry(
              organizationId,
              entryId,
              body as TrashFileEntry,
              options
            )
          ).data
        case "restore":
          return (
            await restoreFileEntry(
              organizationId,
              entryId,
              body as RestoreFileEntry,
              options
            )
          ).data
        case "purge":
          return (
            await purgeFileEntry(
              organizationId,
              entryId,
              body as PurgeFileEntry,
              options
            )
          ).data
      }
    },
    readOperation: async (id, signal) =>
      (
        await getFileOperation(organizationId, id, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
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
          organizationId={organizationId}
          authorizationVersion={authorizationVersion}
          root={root}
          contentScopeKey={contentScopeKey}
        />
      )}
      renderReferences={(entry) => (
        <FileReferenceLocations
          organizationId={organizationId}
          authorizationVersion={authorizationVersion}
          entryId={entry.id}
        />
      )}
    >
      {children}
    </SharedFilePathOperations>
  )
}
