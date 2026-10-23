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
import { useTranslation } from "react-i18next"
import type { ExecuteFileBatch } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import type { FileEntryView, FolderView } from "./types"
import { FileBatchDialog } from "./file-batch-dialog"
import { FileBatchResults } from "./file-batch-results"
import type { FileEntryDialog } from "./file-entry-dialog"
import { fileRequestErrorMessage } from "./file-errors"
import { useFileBatch, type FileBatchPorts } from "./use-file-batch"

export type FileBatchPermissions = {
  canReadFiles: boolean
  canReadFolders: boolean
  canUpdateFiles: boolean
  canUpdateFolders: boolean
  canDeleteFiles: boolean
  canDeleteFolders: boolean
  canRestore: boolean
  canPurge: boolean
}
export type FileBatchAdapter<E extends FileEntryView> = {
  recordScopeKey: string
  queryKey: QueryKey
  ports: FileBatchPorts
  canAct: (entry: E, action: ExecuteFileBatch["action"]) => boolean
  readEntry: (id: string, signal: AbortSignal) => Promise<E>
  readImpact: ComponentProps<typeof FileBatchDialog<E>>["readImpact"]
}
export type FileBatchActions<E extends FileEntryView> = {
  triggerId: string
  available: boolean
  onBatch: (entries: readonly E[], action: ExecuteFileBatch["action"]) => void
}
export function FileBatches<E extends FileEntryView>({
  ActionsContext,
  adapter,
  contentScopeKey,
  permissions,
  renderFolderPicker,
  children,
}: {
  ActionsContext: Context<FileBatchActions<E> | null>
  adapter: FileBatchAdapter<E>
  contentScopeKey: string
  permissions?: FileBatchPermissions
  renderFolderPicker: ComponentProps<
    typeof FileEntryDialog<E>
  >["renderFolderPicker"]
  children: ReactNode
}) {
  const { t } = useTranslation(["files", "common"])
  const client = useQueryClient()
  const triggerId = useId()
  const focusId = useRef(triggerId)
  const [folderResult, setFolderResult] = useState<
    ((folder: FolderView | null) => void) | null
  >(null)
  const retryRequest = useRef<AbortController | null>(null)
  const published = useRef(new Set<string>())
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string>()
  const [names, setNames] = useState<{
    batchId: string
    values: ReadonlyMap<string, string>
  }>()
  const [selection, setSelection] = useState<{
    entries: readonly E[]
    action: ExecuteFileBatch["action"]
  } | null>(null)
  const canRead = Boolean(
    permissions?.canReadFiles && permissions.canReadFolders
  )
  const batch = useFileBatch({
    contentScopeKey,
    recordScopeKey: adapter.recordScopeKey,
    ports: adapter.ports,
    canRead,
  })
  useEffect(
    () => () => {
      retryRequest.current?.abort()
    },
    []
  )
  // 选择窗口结束或授权范围卸载时，释放等待目标目录的表单。Promise 只采纳首次结果。
  useEffect(() => () => folderResult?.(null), [folderResult])
  useEffect(() => {
    for (const item of batch.response?.items ?? []) {
      if (
        item.operation &&
        ["committed", "cleaning", "completed"].includes(item.operation.phase)
      ) {
        const fact = JSON.stringify([item.operation.id, item.operation.phase])
        if (!published.current.has(fact)) {
          published.current.add(fact)
          void client.invalidateQueries({
            queryKey: adapter.queryKey,
          })
        }
      }
    }
  }, [batch.response, client, adapter.queryKey])
  const focus = () =>
    document.getElementById(focusId.current) ??
    document.getElementById(triggerId)
  const choose = (
    entries: readonly E[],
    action: ExecuteFileBatch["action"]
  ) => {
    if (!canRead || !batch.available || batch.submitting) return
    focusId.current =
      document.activeElement instanceof HTMLElement && document.activeElement.id
        ? document.activeElement.id
        : triggerId
    setError(undefined)
    setSelection({ entries, action })
  }
  const finishFolder = (folder: FolderView | null) => {
    setFolderResult(null)
    folderResult?.(folder)
  }
  const retryFailed = async (
    ids: string[],
    action: ExecuteFileBatch["action"]
  ) => {
    if (retrying) return
    const request = new AbortController()
    retryRequest.current = request
    setRetrying(true)
    setError(undefined)
    try {
      const entries = await Promise.all(
        ids.map((id) => adapter.readEntry(id, request.signal))
      )
      // 新批次只使用重新读回的修订与生命周期，并重新确认目标；旧批次的事实保留。
      if (!request.signal.aborted) choose(entries, action)
    } catch (cause) {
      if (!request.signal.aborted)
        setError(fileRequestErrorMessage(cause, t("common:operationFailed")))
    } finally {
      if (!request.signal.aborted) setRetrying(false)
    }
  }
  const canContinue =
    canRead &&
    Boolean(
      permissions &&
      batch.record &&
      (batch.record.action === "restore"
        ? permissions.canRestore
        : batch.record.action === "purge"
          ? permissions.canPurge
          : batch.record.action === "trash"
            ? permissions.canDeleteFiles || permissions.canDeleteFolders
            : permissions.canUpdateFiles || permissions.canUpdateFolders)
    )
  return (
    <ActionsContext
      value={{
        triggerId,
        available: canRead && batch.available && !batch.submitting,
        onBatch: choose,
      }}
    >
      <FileActivityLayout
        contentId={triggerId}
        activity={
          <>
            {Boolean(batch.recordError) && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {t("files:batchRecordsUnavailable")}
                </p>
                <Button variant="outline" onClick={batch.retryRecords}>
                  {t("common:retry")}
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {retrying && <p role="status">{t("common:loading")}</p>}
            {batch.records.length > 1 && (
              <nav aria-label={t("files:batchHistory")}>
                <ol className="max-h-32 space-y-2 overflow-auto">
                  {batch.records.map((record) => (
                    <li key={record.batchId}>
                      <Button
                        variant="ghost"
                        className="h-auto max-w-full text-start [overflow-wrap:anywhere] whitespace-normal"
                        aria-pressed={record.batchId === batch.record?.batchId}
                        disabled={batch.submitting}
                        onClick={() => batch.selectRecord(record)}
                      >
                        {t("files:batchIdentity", { id: record.batchId })}
                      </Button>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <FileBatchResults
              batch={batch}
              names={
                names?.batchId === batch.record?.batchId
                  ? names?.values
                  : undefined
              }
              canContinue={canContinue && !retrying}
              canRetryFailed={canContinue && batch.available && !retrying}
              onRetryFailed={(ids, action) => void retryFailed(ids, action)}
            />
          </>
        }
      >
        {children}
      </FileActivityLayout>
      {selection && (
        <FileBatchDialog
          {...selection}
          open
          contentScopeKey={contentScopeKey}
          canAct={adapter.canAct}
          selectFolder={() =>
            new Promise((resolve) => {
              setFolderResult(() => resolve)
            })
          }
          readImpact={adapter.readImpact}
          onSubmit={async (input) => {
            setNames({
              batchId: input.batchId,
              values: new Map(
                selection.entries.map((entry) => [entry.id, entry.name])
              ),
            })
            await batch.start(input)
          }}
          onClose={() => setSelection(null)}
          returnFocus={focus}
        />
      )}
      {renderFolderPicker({
        open: folderResult !== null,
        onOpenChange: (open) => {
          if (!open) finishFolder(null)
        },
        canPick: (folder) =>
          folder.state === "active" &&
          (selection?.action !== "move" ||
            (!selection.entries.every(
              (entry) => entry.parentId === folder.id
            ) &&
              !selection.entries.some(
                (entry) =>
                  entry.kind === "folder" &&
                  entry.path.every(
                    (segment, index) => folder.path[index] === segment
                  )
              ))),
        onPick: async (folder) => finishFolder(folder),
      })}
    </ActionsContext>
  )
}
