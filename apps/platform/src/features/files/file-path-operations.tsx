import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import { type FileScope } from "./queries"
import type { FolderView as FolderResponse } from "@workspace/admin/files"
import type { FileEntryView as FileEntryResponse } from "@workspace/admin/files"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import { FileEntryDialog } from "@workspace/admin/files"
import { FileDeleteDialog } from "@workspace/admin/files"
import { FilePathQueue } from "@workspace/admin/files"
import { FileReferenceLocations } from "./file-reference-locations"
import {
  canPerformFileAction,
  canShowFileAction,
  type FilePermissions,
} from "./file-permissions"
import { PathActionsContext } from "./path-context"
import {
  useFilePathOperations,
  type FilePathAction,
} from "@workspace/admin/files"

const pathStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}

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
  const client = useQueryClient()
  const pathTriggerId = useId()
  const focusId = useRef(pathTriggerId)
  const published = useRef(new Set<string>())
  const [selection, setSelection] = useState<{
    entry: FileEntryResponse
    action: FilePathAction
  } | null>(null)
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: scope.key })
  }
  const allowed = (entry: FileEntryResponse, action: FilePathAction) =>
    canPerformFileAction(entry, action, scope, permissions)
  const queue = useFilePathOperations({
    userId,
    ownerKey: "platform",
    storage: pathStorage,
    canPerform: (command) => allowed(command.entry, command.action),
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
    onCompleted: (operation) => {
      invalidate()
      onCompleted?.(operation)
    },
  })
  useEffect(() => {
    for (const job of queue.jobs) {
      if (
        (job.phase === "committed" || job.phase === "cleaning") &&
        !published.current.has(job.id)
      ) {
        // 发布后条目和配额已是新事实，即使源对象清理尚未结束也应读回。
        published.current.add(job.id)
        void client.invalidateQueries({
          queryKey: scope.key,
        })
      }
    }
  }, [client, scope, queue.jobs])
  const canPerform = (entry: FileEntryResponse, action: FilePathAction) =>
    queue.available &&
    allowed(entry, action) &&
    !queue.jobs.some(
      (job) =>
        job.entryId === entry.id &&
        job.phase !== "completed" &&
        job.phase !== "failed"
    )
  const returnFocus = () =>
    document.getElementById(focusId.current) ??
    document.getElementById(pathTriggerId)
  const readEntry = async (id: string, signal: AbortSignal) =>
    (
      await getPlatformFileEntry(id, {
        signal,
        headers: { [requestLanguageHeader]: locale },
      })
    ).data
  return (
    <PathActionsContext
      value={{
        pathTriggerId,
        canShow: (entry, action) =>
          canShowFileAction(entry, action, scope, permissions),
        canPerform,
        onAction: (entry, action) => {
          if (!canPerform(entry, action)) return
          focusId.current =
            document.activeElement instanceof HTMLElement &&
            document.activeElement.id
              ? document.activeElement.id
              : pathTriggerId
          setSelection({ entry, action })
        },
      }}
    >
      <div id={pathTriggerId} tabIndex={-1} className="space-y-4">
        {children}
      </div>
      <FilePathQueue
        jobs={queue.jobs}
        recordError={queue.recordError}
        onCheck={(id) => void queue.check(id)}
        onDismiss={queue.dismiss}
        emptyFocus={() => document.getElementById(pathTriggerId)}
      />
      {selection &&
        (selection.action === "trash" || selection.action === "purge" ? (
          <FileDeleteDialog
            {...selection}
            action={selection.action}
            open
            contentScopeKey={contentScopeKey}
            canSubmit={canPerform(selection.entry, selection.action)}
            execute={queue.execute}
            readEntry={readEntry}
            readImpact={async (id, action, signal) =>
              (
                await getPlatformFileEntryImpact(
                  id,
                  { action },
                  {
                    signal,
                    headers: { [requestLanguageHeader]: locale },
                  }
                )
              ).data
            }
            onClose={() => setSelection(null)}
            returnFocus={returnFocus}
            referenceLocations={
              <FileReferenceLocations
                scope={scope}
                entryId={selection.entry.id}
              />
            }
          />
        ) : (
          <FileEntryDialog
            {...selection}
            action={selection.action}
            root={root}
            renderFolderPicker={(picker) => (
              <ConnectedFolderPickerDialog
                {...picker}
                scope={scope}
                root={root}
                contentScopeKey={contentScopeKey}
              />
            )}
            open
            contentScopeKey={contentScopeKey}
            canSubmit={canPerform(selection.entry, selection.action)}
            execute={queue.execute}
            readEntry={readEntry}
            onClose={() => setSelection(null)}
            returnFocus={returnFocus}
          />
        ))}
    </PathActionsContext>
  )
}
