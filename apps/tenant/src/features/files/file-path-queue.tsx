import { useId, useRef } from "react"
import { useTranslation } from "react-i18next"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import type { FilePathJob } from "./use-file-path-operations"

export function FilePathQueue({
  jobs,
  recordError,
  onCheck,
  onDismiss,
}: {
  jobs: FilePathJob[]
  recordError: boolean
  onCheck: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const id = useId()
  const heading = useRef<HTMLHeadingElement | null>(null)
  const actions = {
    rename: t("files:renameEntry"),
    move: t("files:moveEntry"),
    trash: t("files:trashEntry"),
    restore: t("files:restoreEntry"),
    purge: t("files:purgeEntry"),
  }
  const status = (phase: FilePathJob["phase"]) => {
    switch (phase) {
      case "unconfirmed":
        return t("files:pathUnconfirmed")
      case "pending":
      case "preparing":
        return t("files:pathPreparing")
      case "committed":
      case "cleaning":
        return t("files:pathCommitted")
      case "completed":
        return t("files:pathCompleted")
      case "failed":
        return t("files:pathFailed")
    }
  }
  if (!jobs.length && !recordError) return null
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-lg border p-4">
      <h2 id={id} ref={heading} tabIndex={-1} className="font-semibold">
        {t("files:pathQueue")}
      </h2>
      {recordError && (
        <p role="alert" className="text-sm text-destructive">
          {t("files:pathRecordUnavailable")}
        </p>
      )}
      <ul className="space-y-3">
        {jobs.map((job) => {
          const terminal = job.phase === "completed" || job.phase === "failed"
          const name =
            job.name ??
            t("files:pathTask", {
              action: actions[job.action],
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
                {actions[job.action]}
              </p>
              <p role="status" className="text-sm">
                {status(job.phase)}
              </p>
              {job.error && (
                <p role="alert" className="text-sm text-destructive">
                  {job.error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {!terminal && (
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
                {terminal && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onDismiss(job.id)
                      heading.current?.focus()
                    }}
                  >
                    {t("files:dismissOperation")}
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
