import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  getFileEntry,
  getFileOperation,
  overwriteOrganizationFile,
  requestLanguageHeader,
  uploadOrganizationFile,
} from "@workspace/api-client"
import type { FileVersionReference } from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { fileKeys, fileRequestErrorMessage } from "./file-queries"
import { UploadActionsContext } from "./upload-context"
import { UploadQueue } from "./upload-queue"
import {
  UploadSelectionDialog,
  type FileUploadSelection,
} from "./upload-selection-dialog"
import { useUploadQueue, type FileUploadTarget } from "./use-upload-queue"

const uploadStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}

type FileUploadsProps = {
  userId: string
  organizationId: string
  authorizationVersion: number
  contentScopeKey: string
  canUpload: boolean
  canOverwrite: boolean
  onOpenVersion: (reference: FileVersionReference) => void
  children: ReactNode
}

export function FileUploads({
  userId,
  organizationId,
  authorizationVersion,
  contentScopeKey,
  canUpload,
  canOverwrite,
  onOpenVersion,
  children,
}: FileUploadsProps) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
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
    userId,
    organizationId,
    storage: uploadStorage,
    canUpload,
    canOverwrite,
    upload: async (fields, file, signal) =>
      (
        await uploadOrganizationFile(
          organizationId,
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    overwrite: async (fileId, fields, file, signal) =>
      (
        await overwriteOrganizationFile(
          organizationId,
          fileId,
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    readOperation: async (operationId, signal) =>
      (
        await getFileOperation(organizationId, operationId, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    onCompleted: () => {
      // completed 是清理结束的正式回执；提交/准备阶段不会提前刷新列表或显示完成。
      void Promise.all(
        ["list", "breadcrumbs", "workspace", "entry", "versions"].map(
          (resource) =>
            queryClient.invalidateQueries({
              queryKey: [
                ...fileKeys.scope(organizationId),
                authorizationVersion,
                resource,
              ],
            })
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
      const entry = (
        await getFileEntry(
          organizationId,
          draft.kind === "upload" ? draft.parent.id : draft.target.id,
          {
            signal: controller.signal,
            headers: { [requestLanguageHeader]: locale },
          }
        )
      ).data
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
    <UploadActionsContext
      value={{
        uploadTriggerId,
        onUpload: (parent) => choose({ kind: "upload", parent }),
        onOverwrite: (file) => choose({ kind: "overwrite", target: file }),
      }}
    >
      {children}
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
    </UploadActionsContext>
  )
}
