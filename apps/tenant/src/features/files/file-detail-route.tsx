import { useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  ResourceList,
} from "@workspace/admin"
import { getOrganizationAccessOptions } from "@workspace/api-client"
import {
  type FileResponse,
  type FileVersionResponse,
  type FolderResponse,
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
} from "./file-queries"

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
  const entry = useQuery(
    getFileEntryOptions(organizationId, authorizationVersion, entryId, locale)
  )
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
  return (
    <ResourceList
      title={entry.data.name}
      status="ready"
      actions={
        <Button
          variant="outline"
          render={
            <Link
              to="/app/files/$organizationId"
              params={{ organizationId }}
              search={{ parentId: entry.data.parentId ?? entry.data.id }}
            />
          }
        >
          {t("files:openLocation")}
        </Button>
      }
    >
      {entry.data.kind === "file" ? (
        <FileVersionDetails
          file={entry.data}
          authorizationVersion={authorizationVersion}
        />
      ) : (
        <FolderDetails folder={entry.data} />
      )}
    </ResourceList>
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
