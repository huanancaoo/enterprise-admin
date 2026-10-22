import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import {
  FileBrowser,
  formatFileSize,
  type FileView,
} from "@workspace/admin/files"
import type { AnnouncementDetail } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  type FileScope,
  workspaceOptions,
  versionsOptions,
  fileRequestErrorMessage,
  fileRequestIsDenied,
} from "./queries"
import { usePickerBrowser } from "./use-picker-browser"
import { createFormatter } from "@workspace/i18n"
type Attachment = AnnouncementDetail["attachments"][number]
export type Request = {
  kind: "image" | "attachment"
  complete: (value: Attachment | null) => void
}
export function AnnouncementFilePickerDialog({
  scope,
  request,
}: {
  scope: FileScope
  request: Request
}) {
  const { t } = useTranslation(["files", "common"]),
    workspace = useQuery(workspaceOptions(scope))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) request.complete(null)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("files:pickFile")}</DialogTitle>
          <DialogDescription>
            {t("files:pickVersionDescription")}
          </DialogDescription>
        </DialogHeader>
        {fileRequestIsDenied(workspace.error) ? (
          <PermissionDeniedState />
        ) : workspace.isError ? (
          <ErrorState
            message={fileRequestErrorMessage(
              workspace.error,
              t("common:operationFailed")
            )}
            onRetry={() => void workspace.refetch()}
          />
        ) : workspace.data ? (
          <PickerBrowser
            scope={scope}
            request={request}
            root={workspace.data.root}
          />
        ) : (
          <LoadingState />
        )}
      </DialogContent>
    </Dialog>
  )
}
function PickerBrowser({
  scope,
  request,
  root,
}: {
  scope: FileScope
  request: Request
  root: Parameters<typeof usePickerBrowser>[0]["root"]
}) {
  const browser = usePickerBrowser({
    scope,
    root,
    contentScopeKey: scope.contentKey,
    open: true,
    onOpenChange: () => request.complete(null),
  })
  const [selected, setSelected] = useState<{
    file: FileView
    location: string
  }>()
  const location = JSON.stringify(browser.search),
    file = selected?.location === location ? selected.file : undefined
  return (
    <>
      <FileBrowser
        {...browser}
        onOpenFile={(file) => setSelected({ file, location })}
        canOpenFile={(file) => file.state === "active"}
      />
      {file &&
      browser.status === "ready" &&
      browser.page?.items.some((item) => item.id === file.id) ? (
        <PickVersion
          key={file.id}
          scope={scope}
          request={request}
          file={file}
        />
      ) : null}
    </>
  )
}
function PickVersion({
  scope,
  request,
  file,
}: {
  scope: FileScope
  request: Request
  file: FileView
}) {
  const { t } = useTranslation(["files", "common"]),
    query = useQuery(versionsOptions(scope, file.id)),
    [versionId, setVersionId] = useState(file.currentVersion.id)
  if (query.isError)
    return (
      <ErrorState
        message={fileRequestErrorMessage(
          query.error,
          t("common:operationFailed")
        )}
        onRetry={() => void query.refetch()}
      />
    )
  if (!query.data) return <LoadingState />
  const selected = query.data.items.find((version) => version.id === versionId)
  const allowed =
    selected &&
    (request.kind !== "image" ||
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        selected.contentType
      ))
  const label = (version: (typeof query.data.items)[number]) =>
    `${createFormatter(scope.locale).dateTime(new Date(version.createdAt), "UTC")} · ${version.contentType} · ${formatFileSize(version.bytes, scope.locale)} · ${t(version.isCurrent ? "files:currentVersion" : "files:historicalVersion")}`
  return (
    <div className="space-y-3 border-t pt-4">
      <p className="font-medium break-all">{file.name}</p>
      <Select
        value={versionId}
        onValueChange={(value) => {
          if (value) setVersionId(value)
        }}
        items={query.data.items.map((version) => ({
          value: version.id,
          label: label(version),
        }))}
      >
        <SelectTrigger aria-label={t("files:versions")} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {query.data.items.map((version) => (
            <SelectItem key={version.id} value={version.id}>
              {label(version)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DialogFooter>
        <Button variant="outline" onClick={() => request.complete(null)}>
          {t("common:cancel")}
        </Button>
        <Button
          disabled={!allowed || query.isFetching}
          onClick={() => {
            if (allowed && selected)
              request.complete({
                fileId: file.id,
                versionId: selected.id,
                name: file.name,
                byteSize: selected.bytes,
                mimeType: selected.contentType,
              })
          }}
        >
          {t("files:pickFile")}
        </Button>
      </DialogFooter>
    </div>
  )
}
