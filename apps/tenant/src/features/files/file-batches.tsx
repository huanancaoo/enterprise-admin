import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  getFileEntry,
  getFileEntryImpact,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  ExecuteFileBatch,
  FileEntryResponse,
  FolderResponse,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { BatchActionsContext } from "./batch-context"
import { FileBatchDialog } from "./file-batch-dialog"
import { FileBatchResults } from "./file-batch-results"
import { ConnectedFolderPickerDialog } from "./connected-file-picker"
import { fileKeys, fileRequestErrorMessage } from "./file-queries"
import { canPerformFileAction, type FilePermissions } from "./file-permissions"
import { createFileBatchPorts, useFileBatch } from "./use-file-batch"

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
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const client = useQueryClient()
  const triggerId = useId()
  const focusId = useRef(triggerId)
  const folderResult = useRef<((folder: FolderResponse | null) => void) | null>(
    null
  )
  const retryRequest = useRef<AbortController | null>(null)
  const published = useRef(new Set<string>())
  const [choosing, setChoosing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string>()
  const [names, setNames] = useState<{
    batchId: string
    values: ReadonlyMap<string, string>
  }>()
  const [selection, setSelection] = useState<{
    entries: readonly FileEntryResponse[]
    action: ExecuteFileBatch["action"]
  } | null>(null)
  const canRead = Boolean(
    permissions?.canReadFiles && permissions.canReadFolders
  )
  const batch = useFileBatch({
    contentScopeKey,
    recordScopeKey: JSON.stringify([userId, organizationId]),
    ports: createFileBatchPorts(organizationId, locale),
    canRead,
  })
  useEffect(
    () => () => {
      retryRequest.current?.abort()
      folderResult.current?.(null)
      folderResult.current = null
    },
    []
  )
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
            queryKey: fileKeys.scope(organizationId),
          })
        }
      }
    }
  }, [batch.response, client, organizationId])
  const focus = () =>
    document.getElementById(focusId.current) ??
    document.getElementById(triggerId)
  const choose = (
    entries: readonly FileEntryResponse[],
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
  const finishFolder = (folder: FolderResponse | null) => {
    const resolve = folderResult.current
    folderResult.current = null
    setChoosing(false)
    resolve?.(folder)
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
        ids.map(
          async (id) =>
            (
              await getFileEntry(organizationId, id, {
                signal: request.signal,
                headers: { [requestLanguageHeader]: locale },
              })
            ).data
        )
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
    <BatchActionsContext
      value={{
        triggerId,
        available: canRead && batch.available && !batch.submitting,
        onBatch: choose,
      }}
    >
      <div id={triggerId} tabIndex={-1} className="space-y-4">
        {children}
      </div>
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
          names?.batchId === batch.record?.batchId ? names?.values : undefined
        }
        canContinue={canContinue && !retrying}
        canRetryFailed={canContinue && batch.available && !retrying}
        onRetryFailed={(ids, action) => void retryFailed(ids, action)}
      />
      {selection && (
        <FileBatchDialog
          {...selection}
          open
          contentScopeKey={contentScopeKey}
          canAct={(entry, action) =>
            canPerformFileAction(entry, action, organizationId, permissions)
          }
          selectFolder={() =>
            new Promise((resolve) => {
              folderResult.current = resolve
              setChoosing(true)
            })
          }
          readImpact={async (id, action, signal) =>
            (
              await getFileEntryImpact(
                organizationId,
                id,
                { action },
                { signal, headers: { [requestLanguageHeader]: locale } }
              )
            ).data
          }
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
      <ConnectedFolderPickerDialog
        organizationId={organizationId}
        authorizationVersion={authorizationVersion}
        contentScopeKey={contentScopeKey}
        root={root}
        open={choosing}
        onOpenChange={(open) => {
          if (!open) finishFolder(null)
        }}
        canPick={(folder) =>
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
              )))
        }
        onPick={async (folder) => finishFolder(folder)}
      />
    </BatchActionsContext>
  )
}
