import { useRef, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  ResourceList,
} from "@workspace/admin"
import {
  ApiClientError,
  getOrganizationAccessOptions,
} from "@workspace/api-client"
import {
  type FileResponse,
  type FileVersionResponse,
  type FolderResponse,
  type FileEntryResponse,
} from "@workspace/contracts"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { FileDownloadButton } from "./file-content"
import { FilePreviewSheet } from "./file-preview-sheet"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  fileRequestErrorMessage,
  fileRequestIsDenied,
  getFileEntryOptions,
  getFileVersionsOptions,
  getFileWorkspaceOptions,
} from "./file-queries"
import { getFilePermissionsOptions } from "./file-permissions"
import { FileUploads } from "./file-uploads"
import { FilePathOperations } from "./file-path-operations"
import { FileEntryActions } from "./file-entry-actions"
import { FileReferenceLocations } from "./file-reference-locations"

const detailPath = "/app/files/$organizationId/entries/$entryId"

export function FileDetailRoute() {
  const { organizationId, entryId } = useParams({ from: detailPath })
  const { t } = useTranslation("common")
  const access = useQuery(getOrganizationAccessOptions(organizationId))
  if (fileRequestIsDenied(access.error)) return <PermissionDeniedState />
  if (access.isError)
    return (
      <ErrorState
        message={fileRequestErrorMessage(access.error, t("operationFailed"))}
        onRetry={() => void access.refetch()}
      />
    )
  if (!access.data) return <LoadingState />
  return (
    <AuthorizedFileDetail
      key={JSON.stringify([
        organizationId,
        entryId,
        access.data.data.authorizationVersion,
      ])}
      organizationId={organizationId}
      entryId={entryId}
      authorizationVersion={access.data.data.authorizationVersion}
    />
  )
}

function AuthorizedFileDetail({
  organizationId,
  entryId,
  authorizationVersion,
}: {
  organizationId: string
  entryId: string
  authorizationVersion: number
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const navigate = useNavigate({ from: detailPath })
  const scopeKey = JSON.stringify([
    session.user.id,
    organizationId,
    authorizationVersion,
  ])
  const entry = useQuery(
    getFileEntryOptions(organizationId, authorizationVersion, entryId, locale)
  )
  const permissions = useQuery(
    getFilePermissionsOptions(organizationId, authorizationVersion)
  )
  const workspace = useQuery({
    ...getFileWorkspaceOptions(organizationId, authorizationVersion, locale),
    enabled: Boolean(
      permissions.data?.canReadFiles && permissions.data.canReadFolders
    ),
  })
  if (fileRequestIsDenied(entry.error)) return <PermissionDeniedState />
  if (entry.isError)
    return (
      <ResourceList
        title={t("files:detail")}
        status="error"
        error={fileRequestErrorMessage(
          entry.error,
          t("common:operationFailed")
        )}
        onRetry={() => void entry.refetch()}
      />
    )
  if (!entry.data)
    return <ResourceList title={t("files:detail")} status="loading" />
  const root = workspace.data?.root
  const managed = root !== undefined && !fileRequestIsDenied(workspace.error)
  const details = (
    <FileDetailContent
      entry={entry.data}
      authorizationVersion={authorizationVersion}
      actions={
        managed ? (
          <FileEntryActions
            entry={entry.data}
            canOverwrite={Boolean(
              permissions.isSuccess &&
              permissions.data.canUpload &&
              permissions.data.canUpdateFiles
            )}
          />
        ) : undefined
      }
    />
  )
  return managed ? (
    <FileUploads
      userId={session.user.id}
      organizationId={organizationId}
      authorizationVersion={authorizationVersion}
      contentScopeKey={scopeKey}
      canUpload={Boolean(permissions.isSuccess && permissions.data.canUpload)}
      canOverwrite={Boolean(
        permissions.isSuccess &&
        permissions.data.canUpload &&
        permissions.data.canUpdateFiles
      )}
      onOpenVersion={(reference) =>
        void navigate({
          params: { organizationId, entryId: reference.fileId },
          search: { versionId: reference.versionId },
        })
      }
    >
      <FilePathOperations
        userId={session.user.id}
        organizationId={organizationId}
        authorizationVersion={authorizationVersion}
        contentScopeKey={scopeKey}
        root={root}
        permissions={permissions.isSuccess ? permissions.data : undefined}
        onCompleted={(operation) => {
          if (
            operation.action === "purge" &&
            operation.result?.entryId === entryId
          )
            void navigate({
              to: "/app/files/$organizationId",
              params: { organizationId },
              search: { state: "trashed" },
            })
        }}
      >
        {details}
      </FilePathOperations>
    </FileUploads>
  ) : (
    details
  )
}

function FileDetailContent({
  entry,
  authorizationVersion,
  actions,
}: {
  entry: FileEntryResponse
  authorizationVersion: number
  actions?: ReactNode
}) {
  return (
    <ResourceList
      title={entry.name}
      status="ready"
      actions={
        <div className="flex flex-wrap gap-2">
          {actions}
          <FileDetailLocation
            entry={entry}
            authorizationVersion={authorizationVersion}
          />
        </div>
      }
    >
      {entry.state === "trashed" ? (
        <FileTrashDetails entry={entry} />
      ) : (
        <>
          {entry.kind === "file" ? (
            <FileVersionDetails
              file={entry}
              authorizationVersion={authorizationVersion}
            />
          ) : (
            <FolderDetails folder={entry} />
          )}
          <FileReferenceLocations
            organizationId={entry.organizationId}
            entryId={entry.id}
            authorizationVersion={authorizationVersion}
          />
        </>
      )}
    </ResourceList>
  )
}

function FileDetailLocation({
  entry,
  authorizationVersion,
}: {
  entry: FileEntryResponse
  authorizationVersion: number
}) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  const parent = useQuery({
    ...getFileEntryOptions(
      entry.organizationId,
      authorizationVersion,
      entry.parentId ?? entry.id,
      locale
    ),
    enabled: entry.state === "trashed" && entry.parentId !== null,
  })
  // 独立回收项的原父目录可能仍有效或已清除；只有读回的回收父目录才能作为回收站浏览位置。
  if (
    entry.state === "trashed" &&
    parent.isError &&
    !(parent.error instanceof ApiClientError && parent.error.status === 404)
  )
    return (
      <ErrorState
        message={fileRequestErrorMessage(parent.error, t("openLocation"))}
        onRetry={() => void parent.refetch()}
      />
    )
  return (
    <Button
      variant="outline"
      disabled={entry.state === "trashed" && parent.isPending}
      render={
        <Link
          to="/app/files/$organizationId"
          params={{ organizationId: entry.organizationId }}
          search={
            entry.state === "trashed"
              ? {
                  state: "trashed",
                  parentId:
                    parent.data?.state === "trashed"
                      ? parent.data.id
                      : undefined,
                }
              : { parentId: entry.parentId ?? entry.id }
          }
        />
      }
    >
      {t("openLocation")}
    </Button>
  )
}

function FileTrashDetails({ entry }: { entry: FileEntryResponse }) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  const format = createFormatter(locale)
  return (
    <div className="space-y-3">
      <p>{t("trashedContentUnavailable")}</p>
      <dl className="space-y-3 rounded-lg border p-4 text-sm">
        <div>
          <dt>{t("originalLocation")}</dt>
          <dd className="[overflow-wrap:anywhere]">{entry.path.join(" / ")}</dd>
        </div>
        <div>
          <dt>{t("deletedAt")}</dt>
          <dd>
            {entry.deletedAt
              ? format.dateTime(new Date(entry.deletedAt), "UTC")
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("expiresAt")}</dt>
          <dd>
            {entry.expiresAt
              ? format.dateTime(new Date(entry.expiresAt), "UTC")
              : t("noExpiry")}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function FolderDetails({ folder }: { folder: FolderResponse }) {
  const { t } = useTranslation("files")
  return (
    <dl className="space-y-3 rounded-lg border p-4 text-sm">
      <div>
        <dt className="text-muted-foreground">{t("type")}</dt>
        <dd>{t("folder")}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("location")}</dt>
        <dd className="[overflow-wrap:anywhere]">
          {folder.path.join(" / ") || t("root")}
        </dd>
      </div>
    </dl>
  )
}

function FileVersionDetails({
  file,
  authorizationVersion,
}: {
  file: FileResponse
  authorizationVersion: number
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const [preview, setPreview] = useState(false)
  const previewTrigger = useRef<HTMLElement | null>(null)
  const contentScopeKey = JSON.stringify([
    session.user.id,
    file.organizationId,
    authorizationVersion,
  ])
  const { versionId } = useSearch({ from: detailPath })
  const navigate = useNavigate({ from: detailPath })
  const versions = useQuery(
    getFileVersionsOptions(
      file.organizationId,
      authorizationVersion,
      file.id,
      locale
    )
  )
  if (fileRequestIsDenied(versions.error)) return <PermissionDeniedState />
  if (versions.isError)
    return (
      <ErrorState
        message={fileRequestErrorMessage(
          versions.error,
          t("common:operationFailed")
        )}
        onRetry={() => void versions.refetch()}
      />
    )
  if (!versions.data) return <LoadingState />
  const selectedId = versionId ?? file.currentVersion.id
  const selected = versions.data.items.find(
    (version) => version.id === selectedId
  )
  return (
    <div className="min-w-0 space-y-6">
      <section
        aria-label={t("files:content")}
        className="space-y-3 rounded-lg border p-4"
      >
        <h2 className="font-semibold">{t("files:content")}</h2>
        {selected ? (
          <>
            <VersionSummary version={selected} />
            <div className="flex flex-wrap items-start gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  previewTrigger.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null
                  setPreview(true)
                }}
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
              contentScopeKey={contentScopeKey}
              returnFocus={() => previewTrigger.current}
              onClose={() => setPreview(false)}
            />
          </>
        ) : (
          <p role="alert">{t("files:versionUnavailable")}</p>
        )}
      </section>
      <section aria-label={t("files:versions")} className="space-y-3">
        <h2 className="font-semibold">{t("files:versions")}</h2>
        <div className="min-w-0 overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("files:versionCreatedAt")}</TableHead>
                <TableHead>{t("files:type")}</TableHead>
                <TableHead>{t("files:size")}</TableHead>
                <TableHead>{t("files:versionState")}</TableHead>
                <TableHead>{t("files:expiresAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.data.items.map((version) => (
                <TableRow
                  key={version.id}
                  data-state={
                    version.id === selectedId ? "selected" : undefined
                  }
                >
                  <TableCell>
                    <Button
                      variant="link"
                      className="h-auto p-0 text-start"
                      aria-pressed={version.id === selectedId}
                      onClick={() =>
                        void navigate({ search: { versionId: version.id } })
                      }
                    >
                      {createFormatter(locale).dateTime(
                        new Date(version.createdAt),
                        "UTC"
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>{version.contentType}</TableCell>
                  <TableCell>
                    {t("files:byteCount", {
                      bytes: createFormatter(locale).number(version.bytes),
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={version.isCurrent ? "default" : "secondary"}
                    >
                      {version.isCurrent
                        ? t("files:currentVersion")
                        : t("files:historicalVersion")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {version.expiresAt
                      ? createFormatter(locale).dateTime(
                          new Date(version.expiresAt),
                          "UTC"
                        )
                      : t("files:noExpiry")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function VersionSummary({ version }: { version: FileVersionResponse }) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">{t("type")}</dt>
        <dd>{version.contentType}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("size")}</dt>
        <dd>
          {t("byteCount", {
            bytes: createFormatter(locale).number(version.bytes),
          })}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("versionState")}</dt>
        <dd>
          {version.isCurrent ? t("currentVersion") : t("historicalVersion")}
        </dd>
      </div>
    </dl>
  )
}
