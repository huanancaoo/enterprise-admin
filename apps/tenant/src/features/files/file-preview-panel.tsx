import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { HistoryIcon, LinkIcon, XIcon } from "lucide-react"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { FileDownloadButton, ProtectedFilePreview } from "./file-content"
import { FileEntryActions } from "./file-entry-actions"
import {
  getFileEntryOptions,
  fileRequestIsDenied,
  fileRequestErrorMessage,
} from "./file-queries"
import { formatFileSize } from "./file-format"

export function FilePreviewPanel({
  organizationId,
  authorizationVersion,
  entryId,
  contentScopeKey,
  canOverwrite,
  onClose,
}: {
  organizationId: string
  authorizationVersion: number
  entryId: string
  contentScopeKey: string
  canOverwrite: boolean
  onClose: () => void
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    // 窄屏预览排在列表后面，打开时将内容带入视口；关闭仍返回原文件入口。
    if (window.matchMedia("(max-width: 1023px)").matches)
      panel.current?.scrollIntoView({ block: "start" })
  }, [])
  // 面板保持打开时，路径/覆盖操作仍会改变条目；始终读取现有失效链更新后的修订和版本。
  const entry = useQuery(
    getFileEntryOptions(organizationId, authorizationVersion, entryId, locale)
  )
  const file = entry.data?.kind === "file" ? entry.data : undefined
  return (
    <section
      ref={panel}
      role="region"
      aria-label={t("files:preview")}
      className="min-h-svh min-w-0 border-t bg-background p-5 lg:min-h-0 lg:w-80 lg:shrink-0 lg:border-s lg:border-t-0 xl:w-96"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold wrap-anywhere">
          {entry.isError
            ? t("files:preview")
            : (file?.name ?? t("files:preview"))}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-me-2 -mt-1 shrink-0"
          aria-label={t("common:close")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      {fileRequestIsDenied(entry.error) ? (
        <PermissionDeniedState />
      ) : entry.isError ? (
        <ErrorState
          message={fileRequestErrorMessage(
            entry.error,
            t("common:operationFailed")
          )}
          onRetry={() => void entry.refetch()}
        />
      ) : !file ? (
        <LoadingState />
      ) : file.state !== "active" ? (
        <p className="text-sm text-muted-foreground">
          {t("files:trashedContentUnavailable")}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start gap-2">
            <FileDownloadButton
              key={file.currentVersion.id}
              target={{ file, version: file.currentVersion }}
            />
            <FileEntryActions
              entry={file}
              canOverwrite={canOverwrite}
              presentation="preview"
            />
          </div>
          <div className="flex min-h-48 items-center justify-center rounded-lg bg-muted/40 p-4 [&_iframe]:h-[52vh] [&_img]:mx-auto [&_img]:max-h-[52vh] [&>div]:w-full">
            <ProtectedFilePreview
              target={{ file, version: file.currentVersion }}
              contentScopeKey={contentScopeKey}
            />
          </div>
          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p
              className="wrap-anywhere"
              title={file.currentVersion.contentType}
            >
              {file.currentVersion.contentType} ·{" "}
              {formatFileSize(file.currentVersion.bytes, locale)}
            </p>
            <p className="flex flex-wrap gap-2">
              <span>{t("files:updatedAt")}</span>
              {createFormatter(locale).dateTime(
                new Date(file.updatedAt),
                "UTC"
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 border-t pt-4">
            <Button
              nativeButton={false}
              variant="link"
              className="h-auto p-0"
              render={
                <Link
                  to="/app/files/$organizationId/entries/$entryId"
                  params={{ organizationId, entryId }}
                  search={{ versionId: file.currentVersion.id }}
                  hash="file-versions"
                />
              }
            >
              <HistoryIcon />
              {t("files:versions")}
            </Button>
            <Button
              nativeButton={false}
              variant="link"
              className="h-auto p-0"
              render={
                <Link
                  to="/app/files/$organizationId/entries/$entryId"
                  params={{ organizationId, entryId }}
                  search={{ versionId: file.currentVersion.id }}
                  hash="file-references"
                />
              }
            >
              <LinkIcon />
              {t("files:referencesTitle")}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
