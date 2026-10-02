import { useId, useRef } from "react"
import { useTranslation } from "react-i18next"
import type {
  FileOperationResponse,
  FileVersionReference,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"

export type FileUploadStatus =
  | "needs-file"
  | "queued"
  | "hashing"
  | "submitting"
  | "unconfirmed"
  | FileOperationResponse["phase"]
export type FileUploadJobView = {
  id: FileOperationResponse["id"]
  action: "upload" | "overwrite"
  createdAt: string
  status: FileUploadStatus
  name?: string
  bytes?: number
  error?: string
  canRetry: boolean
  hasFile: boolean
  isChecking: boolean
  result?: FileOperationResponse["result"]
}
type UploadQueueProps = {
  jobs: FileUploadJobView[]
  onRetry: (id: string) => void
  onCheck: (id: string) => void
  onDismiss: (id: string) => void
  onOpenResult?: (reference: FileVersionReference) => void
  emptyFocus?: () => HTMLElement | null
}

export function UploadQueue({
  jobs,
  onRetry,
  onCheck,
  onDismiss,
  onOpenResult,
  emptyFocus,
}: UploadQueueProps) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const id = useId()
  const heading = useRef<HTMLHeadingElement | null>(null)
  const label = (status: FileUploadStatus) => {
    switch (status) {
      case "needs-file":
        return t("files:uploadNotSubmitted")
      case "queued":
        return t("files:uploadQueued")
      case "hashing":
        return t("files:uploadPreparing")
      case "submitting":
        return t("files:uploadSubmitting")
      case "unconfirmed":
        return t("files:uploadUnconfirmed")
      case "pending":
      case "preparing":
        return t("files:uploadProcessing")
      case "committed":
      case "cleaning":
        return t("files:uploadCommitted")
      case "completed":
        return t("files:uploadCompleted")
      case "failed":
        return t("files:uploadFailed")
    }
  }
  if (!jobs.length) return null
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-lg border p-4">
      <h2 id={id} ref={heading} tabIndex={-1} className="font-semibold">
        {t("files:uploadQueue")}
      </h2>
      <ul className="space-y-3">
        {jobs.map((job) => {
          const terminal =
            job.status === "completed" ||
            job.status === "failed" ||
            job.status === "needs-file"
          const name =
            job.name ??
            t("files:uploadRestoredTask", {
              time: createFormatter(locale).dateTime(
                new Date(job.createdAt),
                "UTC"
              ),
            })
          return (
            <li
              key={job.id}
              aria-label={name}
              className="space-y-2 rounded-lg border p-3"
            >
              <p className="font-medium [overflow-wrap:anywhere]">{name}</p>
              <p className="text-sm text-muted-foreground">
                {job.action === "overwrite"
                  ? t("files:overwriteFile")
                  : t("files:uploadFiles")}
                {job.bytes !== undefined && (
                  <>
                    {" · "}
                    {t("files:byteCount", {
                      bytes: createFormatter(locale).number(job.bytes),
                    })}
                  </>
                )}
              </p>
              <p role="status" className="text-sm">
                {label(job.status)}
              </p>
              {job.error && (
                <p role="alert" className="text-sm text-destructive">
                  {job.error}
                </p>
              )}
              {(job.status === "failed" || job.status === "needs-file") &&
                !job.hasFile && (
                  <p className="text-sm text-muted-foreground">
                    {t("files:uploadReselectRequired")}
                  </p>
                )}
              <div className="flex flex-wrap gap-2">
                {job.status === "failed" && job.canRetry && (
                  <Button variant="outline" onClick={() => onRetry(job.id)}>
                    {t("files:uploadAgain")}
                  </Button>
                )}
                {!terminal &&
                  job.status !== "queued" &&
                  job.status !== "hashing" &&
                  job.status !== "submitting" && (
                    <Button
                      variant="outline"
                      disabled={job.isChecking}
                      onClick={() => onCheck(job.id)}
                    >
                      {job.isChecking
                        ? t("common:loading")
                        : t("files:checkOperation")}
                    </Button>
                  )}
                {job.status === "completed" &&
                  job.result?.versionId &&
                  onOpenResult && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        onOpenResult({
                          fileId: job.result!.entryId,
                          versionId: job.result!.versionId!,
                        })
                      }
                    >
                      {t("files:openUploadedFile")}
                    </Button>
                  )}
                {terminal && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onDismiss(job.id)
                      if (jobs.length === 1) emptyFocus?.()?.focus()
                      else heading.current?.focus()
                    }}
                  >
                    {t("files:dismissUploadRecord")}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
