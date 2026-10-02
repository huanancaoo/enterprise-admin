import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import type { FileEntryImpact, FileEntryResponse } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { fileKeys, fileRequestErrorMessage } from "./file-queries"
import type { FilePathCommand } from "./use-file-path-operations"

type Props = {
  action: "trash" | "purge"
  entry: FileEntryResponse
  authorizationVersion: number
  contentScopeKey: string
  open: boolean
  canSubmit: boolean
  execute: (command: FilePathCommand) => Promise<void>
  readImpact: (
    id: string,
    action: "trash" | "purge",
    signal: AbortSignal
  ) => Promise<FileEntryImpact>
  readEntry: (id: string, signal: AbortSignal) => Promise<FileEntryResponse>
  onClose: () => void
  returnFocus: () => HTMLElement | null
}
export function FileDeleteDialog(props: Props) {
  return props.open ? (
    <FileDeleteConfirmation
      key={JSON.stringify([
        props.contentScopeKey,
        props.entry.id,
        props.action,
      ])}
      {...props}
    />
  ) : null
}
function FileDeleteConfirmation(props: Props) {
  const { t } = useTranslation(["files", "common", "errors"])
  const locale = useUiLocale()
  const [entry, setEntry] = useState(props.entry)
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useRef<AbortController | undefined>(undefined)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      refresh.current?.abort()
    }
  }, [])
  const impact = useQuery({
    queryKey: [
      ...fileKeys.scope(entry.organizationId),
      props.authorizationVersion,
      "impact",
      entry.id,
      props.action,
      entry.revision,
      locale,
    ],
    retry: false,
    enabled: props.canSubmit,
    queryFn: ({ signal }) => props.readImpact(entry.id, props.action, signal),
  })
  const stale =
    impact.data !== undefined && impact.data.revision !== entry.revision
  const referenced = (impact.data?.referenceCount ?? 0) > 0
  const eligible =
    props.canSubmit &&
    impact.isSuccess &&
    !impact.isFetching &&
    !stale &&
    !referenced &&
    !pending &&
    !refreshing
  async function refreshEntry() {
    const controller = new AbortController()
    refresh.current = controller
    setRefreshing(true)
    try {
      const fresh = await props.readEntry(entry.id, controller.signal)
      if (!controller.signal.aborted) {
        setEntry(fresh)
        setError(undefined)
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(fileRequestErrorMessage(cause, t("common:operationFailed")))
    } finally {
      if (!controller.signal.aborted) setRefreshing(false)
    }
  }
  async function confirm() {
    if (!eligible) return
    setPending(true)
    setError(undefined)
    try {
      // 影响预览是确认上下文；服务端仍在同事务内复核 revision 与所有版本的业务引用。
      await props.execute({ action: props.action, entry })
      if (live.current) props.onClose()
    } catch (cause) {
      if (live.current)
        setError(
          cause instanceof Error ? cause.message : t("common:operationFailed")
        )
    } finally {
      if (live.current) setPending(false)
    }
  }
  const label =
    props.action === "trash" ? t("files:trashEntry") : t("files:purgeEntry")
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !refreshing) props.onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={props.returnFocus}
        aria-busy={pending || refreshing || impact.isFetching}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {props.action === "trash"
              ? t("files:trashDescription")
              : t("files:purgeDescription")}
          </DialogDescription>
        </DialogHeader>
        <p className="font-medium [overflow-wrap:anywhere]">{entry.name}</p>
        {impact.data && (
          <p className="text-sm">
            {t("files:impactSummary", {
              files: createFormatter(locale).number(impact.data.fileCount),
              folders: createFormatter(locale).number(impact.data.folderCount),
              bytes: createFormatter(locale).number(impact.data.bytes),
            })}
          </p>
        )}
        {impact.isPending && props.canSubmit && (
          <p role="status">{t("common:loading")}</p>
        )}
        {impact.isError && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {fileRequestErrorMessage(
                impact.error,
                t("common:operationFailed")
              )}
            </p>
            <Button variant="outline" onClick={() => void impact.refetch()}>
              {t("common:retry")}
            </Button>
          </div>
        )}
        {referenced && (
          <p role="alert" className="text-sm text-destructive">
            {t("files:referenceWarning", {
              references: createFormatter(locale).number(
                impact.data!.referenceCount
              ),
            })}
          </p>
        )}
        {stale && (
          <p role="alert" className="text-sm text-destructive">
            {t("errors:VERSION_CONFLICT")}
          </p>
        )}
        {!props.canSubmit && (
          <p role="alert" className="text-sm text-destructive">
            {t("common:permissionDescription")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending || refreshing}
            onClick={props.onClose}
          >
            {t("common:cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={pending || refreshing || !props.canSubmit}
            onClick={() => void refreshEntry()}
          >
            {t("files:refreshEntry")}
          </Button>
          <Button
            variant="destructive"
            disabled={!eligible}
            onClick={() => void confirm()}
          >
            {pending ? t("common:submitting") : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
