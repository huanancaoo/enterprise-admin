import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { FileEntryDialog } from "./file-entry-dialog"
import { FileDeleteDialog } from "./file-delete-dialog"
import { FilePathQueue } from "./file-path-queue"
import { fileKeys } from "./file-queries"
import { canPerformFileAction, type FilePermissions } from "./file-permissions"
import { PathActionsContext } from "./path-context"
import {
  useFilePathOperations,
  type FilePathAction,
} from "./use-file-path-operations"

const pathStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}

export function FilePathOperations({
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
  const client = useQueryClient()
  const pathTriggerId = useId()
  const focusId = useRef(pathTriggerId)
  const published = useRef(new Set<string>())
  const [selection, setSelection] = useState<{
    entry: FileEntryResponse
    action: FilePathAction
  } | null>(null)
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: fileKeys.scope(organizationId) })
  }
  const allowed = (entry: FileEntryResponse, action: FilePathAction) =>
    canPerformFileAction(entry, action, organizationId, permissions)
  const queue = useFilePathOperations({
    userId,
    organizationId,
    storage: pathStorage,
    canPerform: (command) => allowed(command.entry, command.action),
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
    onCompleted: invalidate,
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
          queryKey: fileKeys.scope(organizationId),
        })
      }
    }
  }, [client, organizationId, queue.jobs])
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
      await getFileEntry(organizationId, id, {
        signal,
        headers: { [requestLanguageHeader]: locale },
      })
    ).data
  return (
    <PathActionsContext
      value={{
        pathTriggerId,
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
            authorizationVersion={authorizationVersion}
            contentScopeKey={contentScopeKey}
            canSubmit={canPerform(selection.entry, selection.action)}
            execute={queue.execute}
            readEntry={readEntry}
            readImpact={async (id, action, signal) =>
              (
                await getFileEntryImpact(
                  organizationId,
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
          />
        ) : (
          <FileEntryDialog
            {...selection}
            action={selection.action}
            root={root}
            open
            authorizationVersion={authorizationVersion}
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
