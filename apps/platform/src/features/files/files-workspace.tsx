import { useEffect, useId, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  useNavigate,
  useSearch,
  useRouterState,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  WorkspacePage,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import type { DataTableStatus } from "@workspace/admin/data-table"
import {
  CreateFolderDialog,
  FileDirectoryTree,
  formatFileSize,
  FileBrowser,
  FileBreadcrumbNavigation,
  type FileView as FileResponse,
  type FolderView as FolderResponse,
} from "@workspace/admin/files"
import {
  createPlatformFileFolder,
  getPlatformFileOperation,
  requestLanguageHeader,
} from "@workspace/api-client"
import type {
  FileListQuery,
  FileUsageResponse,
  PlatformFileWorkspace,
  FileVersionReference,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  FolderPlusIcon,
  UploadIcon,
  Trash2Icon,
  HardDriveIcon,
  ChevronDownIcon,
} from "lucide-react"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { FileUploads } from "./file-uploads"
import { FilePathOperations } from "./file-path-operations"
import { FileEntryActions } from "./file-entry-actions"
import { FileBatches } from "./file-batches"
import { FilePreviewPanel } from "./file-preview-panel"
import { useFileBatchActions } from "./batch-context"
import { useFileUploadActions } from "./upload-context"
import {
  type FileScope,
  useFileScope,
  workspaceOptions,
  entriesOptions,
  trashBreadcrumbOptions,
  folderChildrenOptions,
  fileRequestIsDenied,
  fileRequestErrorMessage,
} from "./queries"
import { filePermissions } from "./file-permissions"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

type FilesWorkspaceProps = {
  scope: FileScope
  search: FileListQuery
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFile: (file: FileResponse) => void
  onOpenVersion: (reference: FileVersionReference) => void
}
export function FilesRoute() {
  const scope = useFileScope(),
    search = useSearch({ from: "/platform/files" }),
    navigate = useNavigate({ from: "/platform/files" })
  return (
    <FilesWorkspace
      key={scope.contentKey}
      scope={scope}
      search={search}
      onSearchChange={(updater) => void navigate({ search: updater })}
      onOpenFile={(file) =>
        void navigate({
          to: "/platform/files/entries/$entryId",
          params: { entryId: file.id },
          search: { versionId: file.currentVersion.id },
        })
      }
      onOpenVersion={(ref) =>
        void navigate({
          to: "/platform/files/entries/$entryId",
          params: { entryId: ref.fileId },
          search: { versionId: ref.versionId },
        })
      }
    />
  )
}
function FilesWorkspace(props: FilesWorkspaceProps) {
  const { scope } = props,
    { t } = useTranslation(["files", "common"])
  const workspace = useQuery(workspaceOptions(scope))
  usePlatformAccessFailure(workspace.error)
  const permissions = filePermissions(scope)
  if (
    !permissions.canReadFiles ||
    !permissions.canReadFolders ||
    fileRequestIsDenied(workspace.error)
  )
    return (
      <WorkspacePage title={t("title")}>
        <PermissionDeniedState />
      </WorkspacePage>
    )
  if (workspace.isError)
    return (
      <WorkspacePage title={t("title")}>
        <ErrorState
          message={fileRequestErrorMessage(
            workspace.error,
            t("common:operationFailed")
          )}
          onRetry={() => void workspace.refetch()}
        />
      </WorkspacePage>
    )
  if (!workspace.data)
    return (
      <WorkspacePage title={t("title")}>
        <LoadingState />
      </WorkspacePage>
    )
  return (
    <FileUploads
      userId={scope.userId}
      scope={scope}
      contentScopeKey={scope.contentKey}
      canUpload={permissions.canUpload}
      canOverwrite={permissions.canUpload && permissions.canUpdateFiles}
      onOpenVersion={props.onOpenVersion}
    >
      <FilePathOperations
        userId={scope.userId}
        scope={scope}
        contentScopeKey={scope.contentKey}
        root={workspace.data.root}
        permissions={permissions}
      >
        <FileBatches
          userId={scope.userId}
          scope={scope}
          contentScopeKey={scope.contentKey}
          root={workspace.data.root}
          permissions={permissions}
        >
          <FileWorkspaceBrowser
            {...props}
            contentScopeKey={scope.contentKey}
            workspace={workspace.data}
            canUpload={permissions.canUpload}
            canOverwrite={permissions.canUpload && permissions.canUpdateFiles}
            canCreateFolder={permissions.canCreateFolder}
            canTrash={permissions.canRestore || permissions.canPurge}
            canManage={
              permissions.canUpdateFiles ||
              permissions.canUpdateFolders ||
              permissions.canDeleteFiles ||
              permissions.canDeleteFolders ||
              permissions.canRestore ||
              permissions.canPurge
            }
          />
        </FileBatches>
      </FilePathOperations>
    </FileUploads>
  )
}
function FileWorkspaceBrowser({
  scope,
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
  contentScopeKey: string
  workspace: PlatformFileWorkspace
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
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  })
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
    trashBreadcrumbOptions(scope, search, workspace.root)
  )
  const entries = useQuery(
    entriesOptions(scope, trash ? search : { ...search, parentId })
  )
  if (
    fileRequestIsDenied(breadcrumbs.error) ||
    fileRequestIsDenied(entries.error)
  )
    return (
      <WorkspacePage title={t("files:title")}>
        <PermissionDeniedState />
      </WorkspacePage>
    )
  if (breadcrumbs.isError)
    return (
      <WorkspacePage title={t("files:title")}>
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
      </WorkspacePage>
    )
  if (!breadcrumbs.data)
    return (
      <WorkspacePage title={t("files:title")}>
        <LoadingState />
      </WorkspacePage>
    )
  const currentFolder = breadcrumbs.data.items.at(-1)!
  // 路由切换期间旧目录仍在屏幕上；必须等新目录身份生效后才能创建或上传。
  const status: DataTableStatus =
    navigating || entries.isPending
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
      <WorkspacePage
        title={t("files:title")}
        actions={
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
        }
      >
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[14rem_minmax(0,1fr)] lg:grid-rows-1">
          <aside
            className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-b bg-background lg:border-e lg:border-b-0"
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
                  childrenQuery={(id) => folderChildrenOptions(scope, id)}
                  root={workspace.root}
                  currentFolderId={trash ? undefined : currentFolder.id}
                  ancestors={trash ? [] : breadcrumbs.data.items}
                  disabled={status !== "ready"}
                  onOpenFolder={openFolder}
                />
              </div>
            </details>
            <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t p-3 lg:block lg:space-y-2">
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
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="flex min-h-16 shrink-0 items-center px-4 pt-6 pb-4 sm:px-6">
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
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
              <div className="min-w-0 flex-1 px-4 pb-6 sm:px-6 lg:min-h-0 lg:overflow-auto">
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
                          to: "/platform/files/entries/$entryId",
                          params: { entryId: entry.id },
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
                              <Link
                                to="/platform/files/entries/$entryId"
                                params={{ entryId: entry.id }}
                                className={buttonVariants({
                                  variant: "outline",
                                })}
                              >
                                {t("files:detail")}
                              </Link>
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
                  scope={scope}
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
      </WorkspacePage>
      <CreateFolderDialog
        open={creatingFolder}
        contentScopeKey={contentScopeKey}
        parent={currentFolder}
        canCreate={canCreateFolder}
        onClose={() => setCreatingFolder(false)}
        returnFocus={() => creationTrigger.current}
        createFolder={async (input, signal) =>
          (
            await createPlatformFileFolder(input, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data
        }
        readOperation={async (operationId, signal) =>
          (
            await getPlatformFileOperation(operationId, {
              signal,
              headers: { [requestLanguageHeader]: locale },
            })
          ).data
        }
        onCompleted={() => {
          void queryClient.invalidateQueries({ queryKey: scope.key })
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
