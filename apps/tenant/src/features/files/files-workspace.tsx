import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  ResourceList,
  type DataTableStatus,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  createFileFolder,
  getFileOperation,
  getOrganizationAccessOptions,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileListQuery,
  FileResponse,
  FileUsageResponse,
  FileWorkspace,
  FileVersionReference,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { CreateFolderDialog } from "./create-folder-dialog"
import { FilePreviewSheet } from "./file-preview-sheet"
import { FileBrowser } from "./file-browser"
import { FileUploads } from "./file-uploads"
import { FilePathOperations } from "./file-path-operations"
import { FileEntryActions } from "./file-entry-actions"
import { FileBatches } from "./file-batches"
import { useFileBatchActions } from "./batch-context"
import { useFileUploadActions } from "./upload-context"
import {
  fileRequestErrorMessage,
  fileRequestIsDenied,
  fileKeys,
  getFileBreadcrumbsOptions,
  getFileEntriesOptions,
  getFileWorkspaceOptions,
  getFileTrashBreadcrumbsOptions,
} from "./file-queries"
import { getFilePermissionsOptions } from "./file-permissions"

type FilesWorkspaceProps = {
  organizationId: string
  search: FileListQuery
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFile: (file: FileResponse) => void
  onOpenVersion: (reference: FileVersionReference) => void
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
      <FileUploads
        key={scopeKey}
        userId={session.user.id}
        organizationId={props.organizationId}
        authorizationVersion={authorizationVersion}
        contentScopeKey={scopeKey}
        canUpload={permissions.isSuccess && permissions.data.canUpload}
        canOverwrite={
          permissions.isSuccess &&
          permissions.data.canUpload &&
          permissions.data.canUpdateFiles
        }
        onOpenVersion={props.onOpenVersion}
      >
        <FilePathOperations
          key={scopeKey}
          userId={session.user.id}
          organizationId={props.organizationId}
          authorizationVersion={authorizationVersion}
          contentScopeKey={scopeKey}
          root={workspace.data.root}
          permissions={permissions.isSuccess ? permissions.data : undefined}
        >
          <FileBatches
            userId={session.user.id}
            organizationId={props.organizationId}
            authorizationVersion={authorizationVersion}
            contentScopeKey={scopeKey}
            root={workspace.data.root}
            permissions={permissions.isSuccess ? permissions.data : undefined}
          >
            <FileWorkspaceBrowser
              {...props}
              authorizationVersion={authorizationVersion}
              contentScopeKey={scopeKey}
              workspace={workspace.data}
              canUpload={permissions.isSuccess && permissions.data.canUpload}
              canOverwrite={
                permissions.isSuccess &&
                permissions.data.canUpload &&
                permissions.data.canUpdateFiles
              }
              canCreateFolder={
                permissions.isSuccess && permissions.data.canCreateFolder
              }
              canTrash={
                permissions.isSuccess &&
                (permissions.data.canRestore || permissions.data.canPurge)
              }
              canManage={
                permissions.isSuccess &&
                (permissions.data.canUpdateFiles ||
                  permissions.data.canUpdateFolders ||
                  permissions.data.canDeleteFiles ||
                  permissions.data.canDeleteFolders ||
                  permissions.data.canRestore ||
                  permissions.data.canPurge)
              }
            />
          </FileBatches>
        </FilePathOperations>
      </FileUploads>
    </ResourceList>
  )
}

function FileWorkspaceBrowser({
  organizationId,
  authorizationVersion,
  contentScopeKey,
  workspace,
  canCreateFolder,
  canUpload,
  canOverwrite,
  canTrash,
  canManage,
  search,
  onSearchChange,
  onOpenFile,
}: FilesWorkspaceProps & {
  authorizationVersion: number
  contentScopeKey: string
  workspace: FileWorkspace
  canCreateFolder: boolean
  canUpload: boolean
  canOverwrite: boolean
  canTrash: boolean
  canManage: boolean
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const [creatingFolder, setCreatingFolder] = useState(false)
  const { uploadTriggerId, onUpload } = useFileUploadActions()
  const batches = useFileBatchActions()
  const creationTrigger = useRef<HTMLButtonElement | null>(null)
  const [preview, setPreview] = useState<FileResponse | null>(null)
  const previewTrigger = useRef<string>("")
  const parentId = search.parentId ?? workspace.root.id
  const trash = search.state === "trashed"
  const breadcrumbs = useQuery(
    trash
      ? getFileTrashBreadcrumbsOptions(
          organizationId,
          authorizationVersion,
          search.parentId,
          workspace.root,
          locale
        )
      : getFileBreadcrumbsOptions(
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
      trash ? search : { ...search, parentId },
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
              parentId: trash ? undefined : workspace.root.id,
              name: undefined,
              page: 1,
            }))
          }
        >
          {trash ? t("files:trash") : t("files:returnToRoot")}
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
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t("files:views")}
      >
        <Button
          variant={trash ? "outline" : "secondary"}
          aria-pressed={!trash}
          onClick={() =>
            onSearchChange((current) => ({
              ...current,
              state: "active",
              parentId: workspace.root.id,
              name: undefined,
              page: 1,
            }))
          }
        >
          {t("files:activeFiles")}
        </Button>
        {canTrash && (
          <Button
            variant={trash ? "secondary" : "outline"}
            aria-pressed={trash}
            onClick={() =>
              onSearchChange((current) => ({
                ...current,
                state: "trashed",
                parentId: undefined,
                name: undefined,
                page: 1,
              }))
            }
          >
            {t("files:trash")}
          </Button>
        )}
      </div>
      <FileBrowser
        contentScopeKey={contentScopeKey}
        currentFolder={currentFolder}
        breadcrumbs={breadcrumbs.data}
        page={entries.data}
        search={search}
        status={status}
        rootLabel={trash ? t("files:trash") : undefined}
        canOpenFile={(file) => file.state === "active"}
        actions={
          <div className="flex flex-wrap gap-2">
            {!trash && canCreateFolder && (
              <Button
                ref={creationTrigger}
                // 创建使用当前目录身份，子项后台刷新不影响该身份；关闭 Dialog 时入口仍需接收焦点。
                disabled={
                  status === "loading" ||
                  status === "error" ||
                  currentFolder.operationId !== null
                }
                onClick={() => setCreatingFolder(true)}
              >
                {t("files:createFolder")}
              </Button>
            )}
            {!trash && canUpload && (
              <Button
                id={uploadTriggerId}
                disabled={
                  status !== "ready" || currentFolder.operationId !== null
                }
                onClick={() => onUpload(currentFolder)}
              >
                {t("files:uploadFiles")}
              </Button>
            )}
          </div>
        }
        renderSelectionActions={
          canOverwrite || canManage
            ? (selected) => {
                const entry = selected.length === 1 ? selected[0] : undefined
                return entry ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      render={
                        <Link
                          to="/app/files/$organizationId/entries/$entryId"
                          params={{ organizationId, entryId: entry.id }}
                        />
                      }
                    >
                      {t("files:detail")}
                    </Button>
                    <FileEntryActions
                      entry={entry}
                      canOverwrite={canOverwrite}
                    />
                  </div>
                ) : selected.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {trash ? (
                      <>
                        <Button
                          id={`${batches.triggerId}-restore`}
                          variant="outline"
                          disabled={!batches.available}
                          onClick={() => batches.onBatch(selected, "restore")}
                        >
                          {t("files:batchRestore")}
                        </Button>
                        <Button
                          id={`${batches.triggerId}-purge`}
                          variant="outline"
                          disabled={!batches.available}
                          onClick={() => batches.onBatch(selected, "purge")}
                        >
                          {t("files:batchPurge")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          id={`${batches.triggerId}-move`}
                          variant="outline"
                          disabled={!batches.available}
                          onClick={() => batches.onBatch(selected, "move")}
                        >
                          {t("files:batchMove")}
                        </Button>
                        <Button
                          id={`${batches.triggerId}-trash`}
                          variant="outline"
                          disabled={!batches.available}
                          onClick={() => batches.onBatch(selected, "trash")}
                        >
                          {t("files:batchTrash")}
                        </Button>
                      </>
                    )}
                  </div>
                ) : null
              }
            : undefined
        }
        error={
          entries.isError
            ? fileRequestErrorMessage(
                entries.error,
                t("common:operationFailed")
              )
            : undefined
        }
        onRetry={() => void entries.refetch()}
        onSearchChange={onSearchChange}
        onOpenFolder={(folder) =>
          onSearchChange((current) => ({
            ...current,
            parentId:
              trash && folder.id === workspace.root.id ? undefined : folder.id,
            name: undefined,
            page: 1,
          }))
        }
        onOpenFile={(file) => {
          // 列表刷新会重建单元格；按稳定入口 ID 返回当前按钮，不能保存已卸载的 DOM。
          previewTrigger.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement.id
              : ""
          setPreview(file)
        }}
        onLocate={(entry) =>
          onSearchChange((current) => ({
            ...current,
            parentId: entry.parentId ?? workspace.root.id,
            name: undefined,
            page: 1,
          }))
        }
      />
      <CreateFolderDialog
        open={creatingFolder}
        contentScopeKey={contentScopeKey}
        parent={currentFolder}
        authorizationVersion={authorizationVersion}
        canCreate={canCreateFolder}
        onClose={() => setCreatingFolder(false)}
        returnFocus={() => creationTrigger.current}
        createFolder={async (input, signal) =>
          (
            await createFileFolder(organizationId, input, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data
        }
        readOperation={async (operationId, signal) =>
          (
            await getFileOperation(organizationId, operationId, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data
        }
        onCompleted={() => {
          void Promise.all(
            ["list", "breadcrumbs", "workspace"].map((resource) =>
              queryClient.invalidateQueries({
                queryKey: [
                  ...fileKeys.scope(organizationId),
                  authorizationVersion,
                  resource,
                ],
              })
            )
          )
        }}
      />
      <FilePreviewSheet
        target={
          preview ? { file: preview, version: preview.currentVersion } : null
        }
        contentScopeKey={contentScopeKey}
        returnFocus={() => document.getElementById(previewTrigger.current)}
        onClose={() => setPreview(null)}
        onOpenDetails={preview ? () => onOpenFile(preview) : undefined}
      />
    </>
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
