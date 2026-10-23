import { FileActivityLayout } from "./file-activity-layout"
import {
  useEffect,
  useId,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { FileVersionReference } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { fileRequestErrorMessage } from "./file-errors"
import { UploadQueue } from "./upload-queue"
import {
  UploadSelectionDialog,
  type FileUploadSelection,
} from "./upload-selection-dialog"
import { useUploadQueue, type FileUploadTarget } from "./use-upload-queue"
import type { FileEntryView, FileView, FolderView } from "./types"

export type FileUploadAdapter = Pick<
  Parameters<typeof useUploadQueue>[0],
  "userId" | "ownerKey" | "upload" | "overwrite" | "readOperation"
> & {
  readEntry: (id: string, signal: AbortSignal) => Promise<FileEntryView>
  completedQueryKeys: readonly QueryKey[]
}
export type FileUploadActions<
  D extends FolderView = FolderView,
  F extends FileView = FileView,
> = {
  uploadTriggerId: string
  onUpload: (folder: D) => void
  onOverwrite: (file: F) => void
}
const uploadStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}
export function FileUploads<D extends FolderView, F extends FileView>({
  ActionsContext,
  adapter,
  contentScopeKey,
  canUpload,
  canOverwrite,
  onOpenVersion,
  children,
}: {
  ActionsContext: Context<FileUploadActions<D, F> | null>
  adapter: FileUploadAdapter
  contentScopeKey: string
  canUpload: boolean
  canOverwrite: boolean
  onOpenVersion: (reference: FileVersionReference) => void
  children: ReactNode
}) {
  const { t } = useTranslation(["files", "common"])
  const queryClient = useQueryClient()
  const uploadTriggerId = useId()
  const focusId = useRef(uploadTriggerId)
  const retryRequest = useRef<AbortController | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string>()
  const [selection, setSelection] = useState<{
    target: FileUploadTarget
    initialFiles?: FileUploadSelection[]
  } | null>(null)
  useEffect(() => () => retryRequest.current?.abort(), [])
  const queue = useUploadQueue({
    ...adapter,
    storage: uploadStorage,
    canUpload,
    canOverwrite,
    onCompleted: () => {
      // 上传仅在清理完成后刷新；路径与批量的已发布事实有各自的刷新时机。
      void Promise.all(
        adapter.completedQueryKeys.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      )
    },
  })
  const captureFocus = () => {
    focusId.current =
      document.activeElement instanceof HTMLElement && document.activeElement.id
        ? document.activeElement.id
        : uploadTriggerId
  }
  const choose = (target: FileUploadTarget) => {
    retryRequest.current?.abort()
    setRetrying(false)
    setRetryError(undefined)
    captureFocus()
    setSelection({ target })
  }
  const retry = async (operationId: string) => {
    const draft = queue.getRetryDraft(operationId)
    if (!draft || retrying) return
    captureFocus()
    setRetryError(undefined)
    setRetrying(true)
    const controller = new AbortController()
    retryRequest.current = controller
    try {
      const entry = await adapter.readEntry(
        draft.kind === "upload" ? draft.parent.id : draft.target.id,
        controller.signal
      )
      if (controller.signal.aborted) return
      // 显式重试先读取原目标的当前事实，再重新确认；不把旧修订或旧目录换成当前浏览的根目录。
      const target =
        draft.kind === "upload" && entry.kind === "folder"
          ? { kind: "upload" as const, parent: entry }
          : draft.kind === "overwrite" && entry.kind === "file"
            ? { kind: "overwrite" as const, target: entry }
            : null
      if (!target) throw new Error(t("common:operationFailed"))
      setSelection({
        target,
        initialFiles: [
          {
            file: draft.file,
            name: target.kind === "overwrite" ? target.target.name : draft.name,
          },
        ],
      })
    } catch (error) {
      if (!controller.signal.aborted)
        setRetryError(
          fileRequestErrorMessage(error, t("common:operationFailed"))
        )
    } finally {
      if (!controller.signal.aborted) setRetrying(false)
    }
  }
  return (
    <ActionsContext
      value={{
        uploadTriggerId,
        onUpload: (parent) => choose({ kind: "upload", parent }),
        onOverwrite: (file) => choose({ kind: "overwrite", target: file }),
      }}
    >
      <FileActivityLayout
        activity={
          <>
            {queue.recordError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {queue.recordError}
                </p>
                <Button variant="outline" onClick={queue.retryRecords}>
                  {t("common:retry")}
                </Button>
              </div>
            )}
            {retryError && (
              <p role="alert" className="text-sm text-destructive">
                {retryError}
              </p>
            )}
            {retrying && (
              <p role="status" className="text-sm">
                {t("common:loading")}
              </p>
            )}
            <UploadQueue
              jobs={queue.jobs.map((job) => ({
                ...job,
                canRetry: job.canRetry && !retrying,
              }))}
              onCheck={queue.check}
              onDismiss={queue.dismiss}
              onRetry={(operationId) => void retry(operationId)}
              onOpenResult={onOpenVersion}
              emptyFocus={() => document.getElementById(uploadTriggerId)}
            />
          </>
        }
      >
        {children}
      </FileActivityLayout>
      {selection && (
        <UploadSelectionDialog
          {...selection.target}
          initialFiles={selection.initialFiles}
          open
          contentScopeKey={contentScopeKey}
          canSubmit={
            selection.target.kind === "upload" ? canUpload : canOverwrite
          }
          onClose={() => setSelection(null)}
          returnFocus={() =>
            document.getElementById(focusId.current) ??
            document.getElementById(uploadTriggerId)
          }
          onSubmit={async (items) => {
            queue.enqueue(selection.target, items)
          }}
        />
      )}
    </ActionsContext>
  )
}
