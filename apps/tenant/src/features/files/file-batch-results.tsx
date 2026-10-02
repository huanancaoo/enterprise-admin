import { useTranslation } from "react-i18next"
import type { FileBatchItemResponse } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { fileRequestErrorMessage } from "./file-queries"
import type { FileBatchState } from "./use-file-batch"

export function FileBatchResults({
  batch,
  names,
  canContinue,
  onRetryFailed,
}: {
  batch: FileBatchState
  names?: ReadonlyMap<string, string>
  canContinue: boolean
  onRetryFailed: (
    entryIds: string[],
    action: NonNullable<FileBatchState["record"]>["action"]
  ) => void
}) {
  const { t } = useTranslation(["files", "common", "errors"])
  const states = {
    pending: t("files:batchPending"),
    preparing: t("files:batchPreparing"),
    committed: t("files:batchCommitted"),
    cleaning: t("files:batchCleaning"),
    completed: t("files:batchCompleted"),
    failed: t("files:batchFailed"),
    covered: t("files:batchCovered"),
    unavailable: t("files:batchUnavailable"),
  } satisfies Record<FileBatchItemResponse["state"], string>

  if (!batch.record) return null
  const { record, response } = batch
  const failedRoots = new Set(
    response?.items
      .filter(
        (item) => item.index === item.rootIndex && item.state === "failed"
      )
      .map((item) => item.index)
  )
  const failedIds =
    response?.items
      .filter((item) => failedRoots.has(item.rootIndex))
      .map((item) => item.entryId) ?? []
  return (
    <section
      className="space-y-4"
      aria-label={t("files:batchResults")}
      aria-busy={batch.submitting || batch.querying}
    >
      <h3 className="text-lg font-semibold">{t("files:batchResults")}</h3>
      <p className="text-sm [overflow-wrap:anywhere]">
        {t("files:batchIdentity", { id: record.batchId })}
      </p>
      {!batch.hasOriginal && (
        <p className="text-sm text-muted-foreground">
          {t("files:batchQueryOnly")}
        </p>
      )}
      {batch.error && (
        <p role="alert" className="text-sm text-destructive">
          {fileRequestErrorMessage(batch.error, t("files:batchUnconfirmed"))}
        </p>
      )}
      {record.phase === "unavailable" && (
        <p role="status" className="text-sm">
          {t("files:batchPollingStopped")}
        </p>
      )}
      {response && (
        <div className="max-h-[60dvh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("files:name")}</TableHead>
                <TableHead>{t("files:batchStatus")}</TableHead>
                <TableHead>{t("files:batchDetails")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.items.map((item) => (
                <TableRow key={item.index}>
                  <TableCell className="[overflow-wrap:anywhere]">
                    {names?.get(item.entryId) ??
                      t("files:batchItem", { number: item.index + 1 })}
                  </TableCell>
                  <TableCell>{states[item.state]}</TableCell>
                  <TableCell className="[overflow-wrap:anywhere]">
                    {item.state === "covered" && (
                      <p>
                        {t("files:batchCoveredBy", {
                          number: item.rootIndex + 1,
                          status: states[response.items[item.rootIndex]!.state],
                        })}
                      </p>
                    )}
                    {item.error && <p>{t(`errors:${item.error.code}`)}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={batch.submitting || batch.querying}
          onClick={() => void batch.check()}
        >
          {t("files:checkOperation")}
        </Button>
        {batch.hasOriginal && record.phase !== "settled" && (
          <Button
            disabled={!canContinue || batch.submitting || batch.querying}
            onClick={() => void batch.continueOriginal()}
          >
            {t("files:batchContinue")}
          </Button>
        )}
        {failedIds.length > 0 && (
          <Button
            variant="outline"
            disabled={batch.submitting || batch.querying}
            onClick={() => onRetryFailed(failedIds, record.action)}
          >
            {t("files:batchRetryFailed")}
          </Button>
        )}
      </div>
    </section>
  )
}
