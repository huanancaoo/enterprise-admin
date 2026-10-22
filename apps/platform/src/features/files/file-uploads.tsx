import { type FileScope } from "./queries"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  getPlatformFileEntry,
  getPlatformFileOperation,
  overwritePlatformFile,
  requestLanguageHeader,
  uploadPlatformFile,
} from "@workspace/api-client"
import type { FileVersionReference } from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { fileRequestErrorMessage } from "./queries"
import { UploadActionsContext } from "./upload-context"
import { UploadQueue } from "@workspace/admin/files"
import {
  UploadSelectionDialog,
  type FileUploadSelection,
} from "@workspace/admin/files"
import { useUploadQueue, type FileUploadTarget } from "@workspace/admin/files"

const uploadStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}

type FileUploadsProps = {
  userId: string
  scope: FileScope
  contentScopeKey: string
  canUpload: boolean
  canOverwrite: boolean
  onOpenVersion: (reference: FileVersionReference) => void
  children: ReactNode
}

export function FileUploads({
  userId,
  scope,
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
    ownerKey: "platform",
    storage: uploadStorage,
    canUpload,
    canOverwrite,
    upload: async (fields, file, signal) =>
      (
        await uploadPlatformFile(
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    overwrite: async (fileId, fields, file, signal) =>
      (
        await overwritePlatformFile(
          fileId,
          { ...fields, file },
          { signal, headers: { [requestLanguageHeader]: locale } }
        )
      ).data,
    readOperation: async (operationId, signal) =>
      (
        await getPlatformFileOperation(operationId, {
          signal,
          headers: { [requestLanguageHeader]: locale },
        })
      ).data,
    onCompleted: () => {
      // completed 是清理结束的正式回执；提交/准备阶段不会提前刷新列表或显示完成。
      void Promise.all(
        ["entries", "breadcrumbs", "workspace", "entry", "versions"].map(
          (resource) =>
            queryClient.invalidateQueries({
              queryKey: [...scope.key, resource],
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
        await getPlatformFileEntry(
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
