import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  ResourceList,
  type DataTableStatus,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { getOrganizationAccessOptions } from "@workspace/api-client"
import type {
  FileListQuery,
  FileResponse,
  FileUsageResponse,
  FileWorkspace,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { FileBrowser } from "./file-browser"
import {
  fileRequestErrorMessage,
  fileRequestIsDenied,
  getFileBreadcrumbsOptions,
  getFileEntriesOptions,
  getFileWorkspaceOptions,
} from "./file-queries"
import { getFilePermissionsOptions } from "./file-permissions"

type FilesWorkspaceProps = {
  organizationId: string
  search: FileListQuery
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFile: (file: FileResponse) => void
}

export function FilesWorkspace(props: FilesWorkspaceProps) {
  const { t } = useTranslation(["files", "common"])
  const access = useQuery(getOrganizationAccessOptions(props.organizationId))
  if (fileRequestIsDenied(access.error)) return <PermissionDeniedState />
  if (access.isError)
    return (
      <ErrorState
        message={fileRequestErrorMessage(
          access.error,
          t("common:operationFailed")
        )}
        onRetry={() => void access.refetch()}
      />
    )
  if (!access.data) return <LoadingState />
  return (
    <AuthorizedFilesWorkspace
      key={access.data.data.authorizationVersion}
      {...props}
      authorizationVersion={access.data.data.authorizationVersion}
    />
  )
}

function AuthorizedFilesWorkspace({
  authorizationVersion,
  ...props
}: FilesWorkspaceProps & { authorizationVersion: number }) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const session = useAuthenticatedSession()!
  const workspace = useQuery(
    getFileWorkspaceOptions(props.organizationId, authorizationVersion, locale)
  )
  const permissions = useQuery(
    getFilePermissionsOptions(props.organizationId, authorizationVersion)
  )
  const scopeKey = JSON.stringify([
    session.user.id,
    props.organizationId,
    authorizationVersion,
  ])
  if (fileRequestIsDenied(workspace.error)) return <PermissionDeniedState />
  if (workspace.isError && !workspace.data)
    return (
      <ResourceList
        title={t("files:title")}
        status="error"
        error={fileRequestErrorMessage(
          workspace.error,
          t("common:operationFailed")
        )}
        onRetry={() => void workspace.refetch()}
      />
    )
  if (!workspace.data)
    return <ResourceList title={t("files:title")} status="loading" />
  return (
    <ResourceList title={t("files:title")} status="ready">
      <FileUsageSummary usage={workspace.data.usage} />
      {workspace.isError && (
        <ErrorState
          message={fileRequestErrorMessage(
            workspace.error,
            t("common:operationFailed")
          )}
          onRetry={() => void workspace.refetch()}
        />
      )}
      {permissions.isError && (
        <p role="alert" className="text-sm text-destructive">
          {fileRequestErrorMessage(
            permissions.error,
            t("common:operationFailed")
          )}
        </p>
      )}
      <FileWorkspaceBrowser
        {...props}
        key={scopeKey}
        authorizationVersion={authorizationVersion}
        contentScopeKey={scopeKey}
        workspace={workspace.data}
      />
    </ResourceList>
  )
}

function FileWorkspaceBrowser({
  organizationId,
  authorizationVersion,
  contentScopeKey,
  workspace,
  search,
  onSearchChange,
  onOpenFile,
}: FilesWorkspaceProps & {
  authorizationVersion: number
  contentScopeKey: string
  workspace: FileWorkspace
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const parentId = search.parentId ?? workspace.root.id
  const breadcrumbs = useQuery(
    getFileBreadcrumbsOptions(
      organizationId,
      authorizationVersion,
      parentId,
      locale
    )
  )
  const entries = useQuery(
    getFileEntriesOptions(
      organizationId,
      authorizationVersion,
      { ...search, parentId },
      locale
    )
  )
  if (
    fileRequestIsDenied(breadcrumbs.error) ||
    fileRequestIsDenied(entries.error)
  )
    return <PermissionDeniedState />
  if (breadcrumbs.isError)
    return (
      <div className="space-y-3">
        <ErrorState
          message={fileRequestErrorMessage(
            breadcrumbs.error,
            t("common:operationFailed")
          )}
          onRetry={() => void breadcrumbs.refetch()}
        />
        <Button
          variant="outline"
          onClick={() =>
            onSearchChange((current) => ({
              ...current,
              parentId: workspace.root.id,
              name: undefined,
              page: 1,
            }))
          }
        >
          {t("files:returnToRoot")}
        </Button>
      </div>
    )
  if (!breadcrumbs.data) return <LoadingState />
  const currentFolder = breadcrumbs.data.items.at(-1)!
  const status: DataTableStatus = entries.isPending
    ? "loading"
    : entries.isError
      ? "error"
      : entries.isFetching
        ? "refreshing"
        : "ready"
  return (
    <FileBrowser
      contentScopeKey={contentScopeKey}
      currentFolder={currentFolder}
      breadcrumbs={breadcrumbs.data}
      page={entries.data}
      search={search}
      status={status}
      error={
        entries.isError
          ? fileRequestErrorMessage(entries.error, t("common:operationFailed"))
          : undefined
      }
      onRetry={() => void entries.refetch()}
      onSearchChange={onSearchChange}
      onOpenFolder={(folder) =>
        onSearchChange((current) => ({
          ...current,
          parentId: folder.id,
          name: undefined,
          page: 1,
        }))
      }
      onOpenFile={onOpenFile}
      onLocate={(entry) =>
        onSearchChange((current) => ({
          ...current,
          parentId: entry.parentId ?? workspace.root.id,
          name: undefined,
          page: 1,
        }))
      }
    />
  )
}

export function FileUsageSummary({ usage }: { usage: FileUsageResponse }) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  const bytes = (value: number) =>
    t("byteCount", { bytes: createFormatter(locale).number(value) })
  return (
    <section
      aria-label={t("usage")}
      className="space-y-3 rounded-lg border p-4"
    >
      <h2 className="font-semibold">{t("usage")}</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {[
          [t("usedBytes"), bytes(usage.usedBytes)],
          [t("reservedBytes"), bytes(usage.reservedBytes)],
          [t("quotaBytes"), bytes(usage.quotaBytes)],
          [t("transientBytes"), bytes(usage.transientBytes)],
          [t("maxUploadBytes"), bytes(usage.maxUploadBytes)],
          [t("trashDays"), t("dayCount", { days: usage.trashDays })],
          [t("historyDays"), t("dayCount", { days: usage.historyDays })],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="[overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
