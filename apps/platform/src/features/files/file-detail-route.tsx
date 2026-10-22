import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  ResourceList,
} from "@workspace/admin"
import { type FileView, formatFileSize } from "@workspace/admin/files"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@workspace/ui/components/table"
import { createFormatter } from "@workspace/i18n"
import {
  useFileScope,
  type FileScope,
  entryOptions,
  workspaceOptions,
  versionsOptions,
  fileRequestIsDenied,
  fileRequestErrorMessage,
} from "./queries"
import { filePermissions } from "./file-permissions"
import { FileUploads } from "./file-uploads"
import { FilePathOperations } from "./file-path-operations"
import { FileEntryActions } from "./file-entry-actions"
import { FileReferenceLocations } from "./file-reference-locations"
import { FileDownloadButton } from "./file-content"
import { FilePreviewSheet } from "./file-preview-sheet"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
const detailPath = "/platform/files/entries/$entryId"
export function FileDetailRoute() {
  const scope = useFileScope(),
    { entryId } = useParams({ from: detailPath })
  return (
    <FileDetail
      key={JSON.stringify([scope.contentKey, entryId])}
      scope={scope}
      entryId={entryId}
    />
  )
}
function FileDetail({ scope, entryId }: { scope: FileScope; entryId: string }) {
  const { t } = useTranslation(["files", "common"]),
    navigate = useNavigate({ from: detailPath })
  const entry = useQuery(entryOptions(scope, entryId)),
    workspace = useQuery(workspaceOptions(scope)),
    permissions = filePermissions(scope)
  usePlatformAccessFailure(entry.error ?? workspace.error)
  if (fileRequestIsDenied(entry.error) || fileRequestIsDenied(workspace.error))
    return <PermissionDeniedState />
  if (entry.isError || workspace.isError)
    return (
      <ErrorState
        message={fileRequestErrorMessage(
          entry.error ?? workspace.error,
          t("common:operationFailed")
        )}
        onRetry={() => void Promise.all([entry.refetch(), workspace.refetch()])}
      />
    )
  if (!entry.data || !workspace.data) return <LoadingState />
  const item = entry.data
  return (
    <FileUploads
      userId={scope.userId}
      scope={scope}
      contentScopeKey={scope.contentKey}
      canUpload={permissions.canUpload}
      canOverwrite={permissions.canUpload && permissions.canUpdateFiles}
      onOpenVersion={(ref) =>
        void navigate({
          params: { entryId: ref.fileId },
          search: { versionId: ref.versionId },
        })
      }
    >
      <FilePathOperations
        userId={scope.userId}
        scope={scope}
        contentScopeKey={scope.contentKey}
        root={workspace.data.root}
        permissions={permissions}
        onCompleted={(op) => {
          if (op.action === "purge" && op.result?.entryId === entryId)
            void navigate({
              to: "/platform/files",
              search: { state: "trashed" },
            })
        }}
      >
        <ResourceList
          title={item.name}
          status="ready"
          actions={
            <div className="flex flex-wrap gap-2">
              <FileEntryActions
                entry={item}
                canOverwrite={
                  permissions.canUpload && permissions.canUpdateFiles
                }
              />
              <Button
                variant="outline"
                render={
                  <Link
                    to="/platform/files"
                    search={
                      item.state === "trashed"
                        ? { state: "trashed" }
                        : {
                            parentId:
                              item.kind === "folder"
                                ? item.id
                                : (item.parentId ?? undefined),
                          }
                    }
                  />
                }
              >
                {t("files:openLocation")}
              </Button>
            </div>
          }
        >
          <div className="space-y-6">
            <p className="text-sm break-all text-muted-foreground">
              {item.path.join(" / ") || t("files:root")}
            </p>
            {item.state === "trashed" ? (
              <div className="space-y-3">
                <p>{t("files:trashedContentUnavailable")}</p>
                <dl className="grid gap-1">
                  <dt>{t("files:deletedAt")}</dt>
                  <dd>
                    {item.deletedAt
                      ? createFormatter(scope.locale).dateTime(
                          new Date(item.deletedAt),
                          "UTC"
                        )
                      : "—"}
                  </dd>
                  <dt>{t("files:expiresAt")}</dt>
                  <dd>
                    {item.expiresAt
                      ? createFormatter(scope.locale).dateTime(
                          new Date(item.expiresAt),
                          "UTC"
                        )
                      : t("files:noExpiry")}
                  </dd>
                </dl>
              </div>
            ) : (
              <>
                {item.kind === "file" && (
                  <FileVersionDetails file={item} scope={scope} />
                )}
                <div id="file-references">
                  <FileReferenceLocations scope={scope} entryId={item.id} />
                </div>
              </>
            )}
          </div>
        </ResourceList>
      </FilePathOperations>
    </FileUploads>
  )
}
function FileVersionDetails({
  file,
  scope,
}: {
  file: FileView
  scope: FileScope
}) {
  const { t } = useTranslation(["files", "common"]),
    { versionId } = useSearch({ from: detailPath }),
    navigate = useNavigate({ from: detailPath }),
    query = useQuery(versionsOptions(scope, file.id))
  const [preview, setPreview] = useState(false),
    trigger = useRef<HTMLButtonElement>(null)
  if (fileRequestIsDenied(query.error)) return <PermissionDeniedState />
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
  const selected = query.data.items.find(
    (version) => version.id === (versionId ?? file.currentVersion.id)
  )
  return (
    <div className="space-y-5">
      <section
        className="space-y-4 rounded-lg border p-4"
        aria-label={t("files:content")}
      >
        <h2 className="font-semibold">{t("files:content")}</h2>
        {selected ? (
          <>
            <p>
              {selected.contentType} ·{" "}
              {formatFileSize(selected.bytes, scope.locale)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                ref={trigger}
                onClick={() => setPreview(true)}
              >
                {t("files:preview")}
              </Button>
              <FileDownloadButton
                key={selected.id}
                target={{ file, version: selected }}
              />
            </div>
            <FilePreviewSheet
              target={preview ? { file, version: selected } : null}
              contentScopeKey={scope.contentKey}
              onClose={() => setPreview(false)}
              returnFocus={() => trigger.current}
            />
          </>
        ) : (
          <p role="alert">{t("files:versionUnavailable")}</p>
        )}
      </section>
      <section
        id="file-versions"
        className="space-y-3"
        aria-label={t("files:versions")}
      >
        <h2 className="font-semibold">{t("files:versions")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              {(
                [
                  "versionCreatedAt",
                  "type",
                  "size",
                  "versionState",
                  "expiresAt",
                ] as const
              ).map((label) => (
                <TableHead key={label}>{t(`files:${label}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((version) => (
              <TableRow
                key={version.id}
                data-state={
                  selected?.id === version.id ? "selected" : undefined
                }
              >
                <TableCell>
                  <Button
                    variant="link"
                    aria-pressed={selected?.id === version.id}
                    onClick={() => {
                      setPreview(false)
                      void navigate({ search: { versionId: version.id } })
                    }}
                  >
                    {createFormatter(scope.locale).dateTime(
                      new Date(version.createdAt),
                      "UTC"
                    )}
                  </Button>
                </TableCell>
                <TableCell>{version.contentType}</TableCell>
                <TableCell>
                  {formatFileSize(version.bytes, scope.locale)}
                </TableCell>
                <TableCell>
                  <Badge variant={version.isCurrent ? "default" : "secondary"}>
                    {t(
                      version.isCurrent
                        ? "files:currentVersion"
                        : "files:historicalVersion"
                    )}
                  </Badge>
                </TableCell>
                <TableCell>
                  {version.expiresAt
                    ? createFormatter(scope.locale).dateTime(
                        new Date(version.expiresAt),
                        "UTC"
                      )
                    : t("files:noExpiry")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
