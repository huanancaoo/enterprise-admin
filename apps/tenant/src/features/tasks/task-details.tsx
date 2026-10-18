import type { TaskCenterItem } from "./task-center-search"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { ErrorState, LoadingState } from "@workspace/admin"
import {
  getBusinessTask,
  getBusinessTaskResult,
  getFileOperation,
  getFileBatch,
  requestLanguageHeader,
} from "@workspace/api-client"
import { BusinessTaskSchema } from "@workspace/contracts/framework-capabilities"
import { FileOperationResponseSchema } from "@workspace/contracts/files"
import { FileBatchResponseSchema } from "@workspace/contracts/file-batches"
import { useUiLocale } from "@workspace/i18n/react"
import { parse as parseContentDisposition } from "content-disposition"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { taskCenterKeys, taskIsActive } from "./task-queries"

type Props = {
  organizationId: string
  source: TaskCenterItem["source"]
  taskId: string
  authorizationVersion: number
  onClose: () => void
}
export function TaskDetails(props: Props) {
  const { t } = useTranslation(["tasks", "files", "common", "errors"])
  const user = useAuthenticatedSession()!.user
  const locale = useUiLocale()
  const client = useQueryClient()
  const downloadController = useRef<AbortController | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  useEffect(() => () => downloadController.current?.abort(), [])
  const key = [
    ...taskCenterKeys.scope(props.organizationId, user.id),
    props.authorizationVersion,
    "details",
    props.source,
    props.taskId,
    locale,
  ]
  const query = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) => {
      const options = { signal, headers: { [requestLanguageHeader]: locale } }
      if (props.source === "business")
        return {
          source: "business" as const,
          item: BusinessTaskSchema.parse(
            (await getBusinessTask(props.organizationId, props.taskId, options))
              .data
          ),
        }
      if (props.source === "file-batch")
        return {
          source: "file-batch" as const,
          item: FileBatchResponseSchema.parse(
            (await getFileBatch(props.organizationId, props.taskId, options))
              .data
          ),
        }
      return {
        source: "file-operation" as const,
        item: FileOperationResponseSchema.parse(
          (await getFileOperation(props.organizationId, props.taskId, options))
            .data
        ),
      }
    },
    refetchInterval: (q) => {
      const value = q.state.data
      if (q.state.error || !value) return false
      return value.source === "business"
        ? taskIsActive(value.item.status)
          ? 1000
          : false
        : value.source === "file-operation"
          ? taskIsActive(value.item.phase)
            ? 1000
            : false
          : value.item.items.some((part) => taskIsActive(part.state))
            ? 1000
            : false
    },
  })
  const download = async () => {
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(true)
    setDownloadError(null)
    try {
      const reply = await getBusinessTaskResult(
        props.organizationId,
        props.taskId,
        {
          signal: controller.signal,
          headers: { [requestLanguageHeader]: locale },
        }
      )
      controller.signal.throwIfAborted()
      const filename = parseContentDisposition(
        reply.headers.get("content-disposition") ?? ""
      ).parameters.filename
      if (!filename) throw new Error("Missing authorized download filename")
      const url = URL.createObjectURL(reply.data)
      try {
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        anchor.click()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setDownloadError(
          error instanceof Error ? error.message : t("errors:INTERNAL_ERROR")
        )
    } finally {
      if (!controller.signal.aborted) setDownloading(false)
    }
  }
  const close = () => {
    downloadController.current?.abort()
    void client.invalidateQueries({
      queryKey: taskCenterKeys.scope(props.organizationId, user.id),
    })
    props.onClose()
  }
  const errors: Record<string, string> = {
    TOO_MANY_ROWS: t("tasks:tooManyExportRows"),
    IMPORT_VALIDATION_FAILED:
      query.data?.source === "business" &&
      query.data.item.type === "invitations.import"
        ? t("tasks:invitationImportValidationFailed")
        : t("tasks:IMPORT_VALIDATION_FAILED"),
    MEMBERSHIP_REQUIRED: t("tasks:MEMBERSHIP_REQUIRED"),
    PERMISSION_DENIED: t("tasks:PERMISSION_DENIED"),
    ORGANIZATION_SUSPENDED: t("tasks:ORGANIZATION_SUSPENDED"),
    RESOURCE_DENIED: t("tasks:RESOURCE_DENIED"),
    EXECUTION_FAILED: t("tasks:EXECUTION_FAILED"),
  }
  const issues = {
    INVALID_NAME: t("tasks:invalidName"),
    INVALID_DESCRIPTION: t("tasks:invalidDescription"),
    INVALID_LOCALE: t("tasks:invalidLocale"),
    INVALID_COLUMNS: t("tasks:invalidColumns"),
    INVALID_FILE: t("tasks:invalidFile"),
    INVALID_WORKSHEET_COUNT: t("tasks:invalidWorksheetCount"),
  }
  const fields = {
    name: t("tasks:name"),
    description: t("tasks:description"),
    contentLocale: t("tasks:contentLocale"),
    file: t("tasks:file"),
  }
  const states = {
    pending: t("files:batchPending"),
    preparing: t("files:batchPreparing"),
    committed: t("files:batchCommitted"),
    cleaning: t("files:batchCleaning"),
    completed: t("files:batchCompleted"),
    failed: t("files:batchFailed"),
    covered: t("files:batchCovered"),
    unavailable: t("files:batchUnavailable"),
  }
  const value = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("tasks:details")}</DialogTitle>
          <DialogDescription className="break-all">
            {props.taskId}
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <LoadingState />
        ) : value?.source === "business" ? (
          <div className="space-y-4">
            <p>{t(`tasks:${value.item.status}`)}</p>
            {value.item.errorCode && (
              <p role="alert">{errors[value.item.errorCode]}</p>
            )}
            {value.item.result?.invitationImport && (
              <p>
                {t(
                  "tasks:invitationImportSummary",
                  value.item.result.invitationImport
                )}
              </p>
            )}
            {value.item.result && !value.item.result.invitationImport && (
              <p>
                {t("tasks:processedCount", {
                  quantity: value.item.result.count,
                })}
              </p>
            )}
            {!!value.item.result?.issues.length && (
              <>
                <p>{t("tasks:noProjectsAdded")}</p>
                <Table tabIndex={0} aria-label={t("tasks:details")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("tasks:row")}</TableHead>
                      <TableHead>{t("tasks:field")}</TableHead>
                      <TableHead>{t("tasks:issue")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {value.item.result.issues.map((issue, index) => (
                      <TableRow key={index}>
                        <TableCell>{issue.row}</TableCell>
                        <TableCell>{fields[issue.field]}</TableCell>
                        <TableCell>{issues[issue.code]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {value.item.resultAvailable && (
              <Button disabled={downloading} onClick={() => void download()}>
                {value.item.type === "invitations.import"
                  ? t("tasks:downloadInvitationReport")
                  : t("tasks:downloadResult")}
              </Button>
            )}
            {downloadError && <p role="alert">{downloadError}</p>}
          </div>
        ) : value?.source === "file-operation" ? (
          <div className="space-y-3">
            <p>{states[value.item.phase]}</p>
            {value.item.errorCode && (
              <p role="alert">{t(`errors:${value.item.errorCode}`)}</p>
            )}
            {value.item.result && (
              <dl className="space-y-2">
                <dt>{t("tasks:entryId")}</dt>
                <dd className="break-all">{value.item.result.entryId}</dd>
                <dt>{t("tasks:revision")}</dt>
                <dd>{value.item.result.revision}</dd>
                {value.item.result.affectedEntries && (
                  <>
                    <dt>{t("tasks:affectedEntries")}</dt>
                    <dd>{value.item.result.affectedEntries}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
        ) : value?.source === "file-batch" ? (
          <Table tabIndex={0} aria-label={t("tasks:details")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tasks:entryId")}</TableHead>
                <TableHead>{t("tasks:status")}</TableHead>
                <TableHead>{t("tasks:details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.item.items.map((item) => (
                <TableRow key={item.index}>
                  <TableCell className="break-all">{item.entryId}</TableCell>
                  <TableCell>{states[item.state]}</TableCell>
                  <TableCell>
                    {item.state === "covered"
                      ? t("files:batchCoveredBy", {
                          number: item.rootIndex + 1,
                          status:
                            states[value.item.items[item.rootIndex]!.state],
                        })
                      : item.error
                        ? t(`errors:${item.error.code}`)
                        : item.operation?.result
                          ? t("tasks:revisionValue", {
                              revision: item.operation.result.revision,
                            })
                          : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("common:close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
