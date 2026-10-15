import { useEffect, useId, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  ResourceList,
  useDocumentTitle,
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
  FolderResponse,
  FileUsageResponse,
  FileWorkspace,
  FileVersionReference,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { CreateFolderDialog } from "./create-folder-dialog"
import { FilePreviewPanel } from "./file-preview-panel"
import { FileDirectoryTree } from "./file-directory-tree"
import { FileSearch } from "./file-search"
import { formatFileSize } from "./file-format"
import {
  FolderPlusIcon,
  UploadIcon,
  Trash2Icon,
  HardDriveIcon,
  ChevronDownIcon,
} from "lucide-react"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { FileBrowser, FileBreadcrumbNavigation } from "./file-browser"
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
  useDocumentTitle(t("files:title"))
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
    <div className="min-w-0">
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
    </div>
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
  // 表格刷新会重挂单元格，操作入口身份由工作区持有，以便对话框关闭后恢复焦点。
  const actionScope = useId()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<{ id: string; scope: string } | null>(
    null
  )
  const browseScope = JSON.stringify([
    search.parentId,
    search.state,
    search.name,
  ])
  const previewId = preview?.scope === browseScope ? preview.id : undefined
  const previewTrigger = useRef<string>("")
  const restorePreviewFocus = useRef(false)
  useEffect(() => {
    if (!previewId && restorePreviewFocus.current) {
      // 预览高亮变化会重挂表格单元格，必须在提交后寻找新的同名入口。
      document.getElementById(previewTrigger.current)?.focus()
      restorePreviewFocus.current = false
    }
  }, [previewId])
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
  const openFolder = (folder: FolderResponse) =>
    onSearchChange((current) => ({
      ...current,
      state: "active",
      parentId: folder.id,
      name: undefined,
      page: 1,
    }))
  return (
    <>
      <div className="grid min-h-svh min-w-0 [--primary:var(--color-blue-600)] lg:grid-cols-[14rem_minmax(0,1fr)] dark:[--primary:var(--color-blue-400)] [&_[data-slot=input-group]]:rounded-md [&_button]:rounded-md">
        <aside
          className="flex min-w-0 flex-col border-b bg-background lg:border-e lg:border-b-0"
          aria-label={t("files:directory")}
        >
          <details className="group lg:contents" open={!isMobile}>
            <summary className="flex h-16 cursor-pointer items-center justify-between px-5 font-semibold lg:h-20 lg:text-lg">
              {t("files:directory")}
              <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="max-h-64 overflow-y-auto lg:max-h-none lg:flex-1">
              <FileDirectoryTree
                key={contentScopeKey}
                organizationId={organizationId}
                authorizationVersion={authorizationVersion}
                root={workspace.root}
                currentFolderId={trash ? undefined : currentFolder.id}
                ancestors={trash ? [] : breadcrumbs.data.items}
                disabled={status !== "ready"}
                onOpenFolder={openFolder}
              />
            </div>
          </details>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t p-3 lg:mt-auto lg:block lg:space-y-2">
            {canTrash && (
              <Button
                variant="ghost"
                className={`w-full justify-start ${trash ? "bg-primary/10 text-primary" : ""}`}
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
                <Trash2Icon />
                {t("files:trash")}
              </Button>
            )}
            <details>
              <summary className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50">
                <HardDriveIcon className="size-4 shrink-0" />
                <span>
                  {t("files:usage")}
                  <span className="ms-2">
                    {formatFileSize(workspace.usage.usedBytes, locale)}
                  </span>
                </span>
              </summary>
              <FileUsageSummary usage={workspace.usage} />
            </details>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="flex min-h-20 flex-wrap items-center gap-3 border-b px-5 py-3">
            <SidebarTrigger className="shrink-0" />
            <h1 className="me-auto text-2xl font-semibold">
              {t("files:title")}
            </h1>
            <FileSearch
              key={search.name ?? ""}
              value={search.name ?? ""}
              pending={status === "loading" || status === "refreshing"}
              onSearch={(name) =>
                onSearchChange((current) => ({
                  ...current,
                  name: name || undefined,
                  page: 1,
                }))
              }
            />
            <div className="flex flex-wrap gap-2">
              {!trash && canCreateFolder && (
                <Button
                  ref={creationTrigger}
                  variant="outline"
                  // 创建使用当前目录身份，子项后台刷新不影响该身份；关闭 Dialog 时入口仍需接收焦点。
                  disabled={
                    status === "loading" ||
                    status === "error" ||
                    currentFolder.operationId !== null
                  }
                  onClick={() => setCreatingFolder(true)}
                >
                  <FolderPlusIcon />
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
                  <UploadIcon />
                  {t("files:uploadFiles")}
                </Button>
              )}
            </div>
          </header>
          <div className="flex min-h-16 items-center border-b px-5 py-3">
            <FileBreadcrumbNavigation
              breadcrumbs={breadcrumbs.data}
              currentFolder={currentFolder}
              busy={status !== "ready"}
              rootLabel={trash ? t("files:trash") : t("files:allFiles")}
              onOpenFolder={(folder) =>
                onSearchChange((current) => ({
                  ...current,
                  parentId:
                    trash && folder.id === workspace.root.id
                      ? undefined
                      : folder.id,
                  name: undefined,
                  page: 1,
                }))
              }
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
            <div className="min-w-0 flex-1">
              <FileBrowser
                workspace
                previewedFileId={previewId}
                renderEntryActions={(entry) => (
                  <FileEntryActions
                    idPrefix={`${actionScope}-row-${entry.id}`}
                    entry={entry}
                    canOverwrite={canOverwrite}
                    presentation="menu"
                    onOpenDetails={() =>
                      void navigate({
                        to: "/app/files/$organizationId/entries/$entryId",
                        params: { organizationId, entryId: entry.id },
                        search:
                          entry.kind === "file"
                            ? { versionId: entry.currentVersion.id }
                            : {},
                      })
                    }
                  />
                )}
                contentScopeKey={contentScopeKey}
                currentFolder={currentFolder}
                breadcrumbs={breadcrumbs.data}
                page={entries.data}
                search={search}
                status={status}
                rootLabel={trash ? t("files:trash") : t("files:allFiles")}
                canOpenFile={(file) => file.state === "active"}
                renderSelectionActions={
                  canOverwrite || canManage
                    ? (selected) => {
                        const entry =
                          selected.length === 1 ? selected[0] : undefined
                        return entry ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              nativeButton={false}
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
                              idPrefix={`${actionScope}-selection-${entry.id}`}
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
                                  onClick={() =>
                                    batches.onBatch(selected, "restore")
                                  }
                                >
                                  {t("files:batchRestore")}
                                </Button>
                                <Button
                                  id={`${batches.triggerId}-purge`}
                                  variant="outline"
                                  disabled={!batches.available}
                                  onClick={() =>
                                    batches.onBatch(selected, "purge")
                                  }
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
                                  onClick={() =>
                                    batches.onBatch(selected, "move")
                                  }
                                >
                                  {t("files:batchMove")}
                                </Button>
                                <Button
                                  id={`${batches.triggerId}-trash`}
                                  variant="outline"
                                  disabled={!batches.available}
                                  onClick={() =>
                                    batches.onBatch(selected, "trash")
                                  }
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
                      trash && folder.id === workspace.root.id
                        ? undefined
                        : folder.id,
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
                  setPreview({ id: file.id, scope: browseScope })
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
            </div>
            {previewId && (
              <FilePreviewPanel
                key={JSON.stringify([contentScopeKey, previewId])}
                organizationId={organizationId}
                authorizationVersion={authorizationVersion}
                entryId={previewId}
                contentScopeKey={contentScopeKey}
                canOverwrite={canOverwrite}
                onClose={() => {
                  restorePreviewFocus.current = true
                  setPreview(null)
                }}
              />
            )}
          </div>
        </div>
      </div>
      <CreateFolderDialog
        open={creatingFolder}
        contentScopeKey={contentScopeKey}
        parent={currentFolder}
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
    </>
  )
}

export function FileUsageSummary({ usage }: { usage: FileUsageResponse }) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  const bytes = (value: number) =>
    t("byteCount", { bytes: createFormatter(locale).number(value) })
  return (
    <section aria-label={t("usage")} className="space-y-3 p-3">
      <h2 className="font-semibold">{t("usage")}</h2>
      <dl className="grid gap-3 text-xs">
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
            <dd className="mt-1 font-medium [overflow-wrap:anywhere] tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
