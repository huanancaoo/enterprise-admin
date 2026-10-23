import { FileActivityLayout } from "./file-activity-layout"
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type Context,
  type ReactNode,
} from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import type { FileOperationResponse } from "@workspace/contracts"
import type { FileEntryView, FolderView } from "./types"
import { FileEntryDialog } from "./file-entry-dialog"
import { FileDeleteDialog } from "./file-delete-dialog"
import { FilePathQueue } from "./file-path-queue"
import {
  useFilePathOperations,
  type FilePathAction,
} from "./use-file-path-operations"

export type FilePathAdapter<E extends FileEntryView> = Pick<
  Parameters<typeof useFilePathOperations<E>>[0],
  "userId" | "ownerKey" | "submit" | "readOperation"
> & {
  queryKey: QueryKey
  canShow: (entry: E, action: FilePathAction) => boolean
  canPerform: (entry: E, action: FilePathAction) => boolean
  readEntry: (id: string, signal: AbortSignal) => Promise<E>
  readImpact: ComponentProps<typeof FileDeleteDialog<E>>["readImpact"]
}
export type FilePathActions<E extends FileEntryView> = {
  pathTriggerId: string
  canShow: (entry: E, action: FilePathAction) => boolean
  canPerform: (entry: E, action: FilePathAction) => boolean
  onAction: (entry: E, action: FilePathAction) => void
}
const pathStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}
export function FilePathOperations<E extends FileEntryView>({
  ActionsContext,
  adapter,
  contentScopeKey,
  root,
  renderFolderPicker,
  renderReferences,
  onCompleted,
  children,
}: {
  ActionsContext: Context<FilePathActions<E> | null>
  adapter: FilePathAdapter<E>
  contentScopeKey: string
  root: FolderView
  renderFolderPicker: ComponentProps<
    typeof FileEntryDialog<E>
  >["renderFolderPicker"]
  renderReferences: (entry: E) => ReactNode
  onCompleted?: (operation: FileOperationResponse) => void
  children: ReactNode
}) {
  const client = useQueryClient()
  const pathTriggerId = useId()
  const focusId = useRef(pathTriggerId)
  const published = useRef(new Set<string>())
  const [selection, setSelection] = useState<{
    entry: E
    action: FilePathAction
  } | null>(null)
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: adapter.queryKey })
  }
  const allowed = adapter.canPerform
  const queue = useFilePathOperations<E>({
    ...adapter,
    storage: pathStorage,
    canPerform: (command) => allowed(command.entry, command.action),
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
          queryKey: adapter.queryKey,
        })
      }
    }
  }, [client, adapter.queryKey, queue.jobs])
  const canPerform = (entry: E, action: FilePathAction) =>
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
  const actions = {
    pathTriggerId,
    canShow: adapter.canShow,
    canPerform,
    onAction: (entry: E, action: FilePathAction) => {
      if (!canPerform(entry, action)) return
      focusId.current =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.id
          ? document.activeElement.id
          : pathTriggerId
      setSelection({ entry, action })
    },
  }
  return (
    <ActionsContext value={actions}>
      <FileActivityLayout
        contentId={pathTriggerId}
        activity={
          <>
            <FilePathQueue
              jobs={queue.jobs}
              recordError={queue.recordError}
              onCheck={(id) => void queue.check(id)}
              onDismiss={queue.dismiss}
              emptyFocus={() => document.getElementById(pathTriggerId)}
            />
          </>
        }
      >
        {children}
      </FileActivityLayout>
      {selection &&
        (selection.action === "trash" || selection.action === "purge" ? (
          <FileDeleteDialog
            {...selection}
            action={selection.action}
            open
            contentScopeKey={contentScopeKey}
            canSubmit={canPerform(selection.entry, selection.action)}
            execute={queue.execute}
            readEntry={adapter.readEntry}
            readImpact={adapter.readImpact}
            onClose={() => setSelection(null)}
            returnFocus={returnFocus}
            referenceLocations={renderReferences(selection.entry)}
          />
        ) : (
          <FileEntryDialog
            {...selection}
            action={selection.action}
            root={root}
            renderFolderPicker={renderFolderPicker}
            open
            contentScopeKey={contentScopeKey}
            canSubmit={canPerform(selection.entry, selection.action)}
            execute={queue.execute}
            readEntry={adapter.readEntry}
            onClose={() => setSelection(null)}
            returnFocus={returnFocus}
          />
        ))}
    </ActionsContext>
  )
}
