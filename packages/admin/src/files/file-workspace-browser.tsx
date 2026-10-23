import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type {
  ExecuteFileBatch,
  FileListQuery,
  FileUsageResponse,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import {
  ChevronDownIcon,
  FolderPlusIcon,
  HardDriveIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { PermissionDeniedState, WorkspacePage } from "../components/page"
import type { DataTableStatus } from "../data-table"
import { CreateFolderDialog } from "./create-folder-dialog"
import { FileBrowser, FileBreadcrumbNavigation } from "./file-browser"
import { fileRequestErrorMessage, fileRequestIsDenied } from "./file-errors"
import { formatFileSize } from "./file-format"
import type { FileView, FolderView, FilePageView } from "./types"

type BrowseRead<T> = Pick<
  UseQueryResult<T, Error>,
  | "data"
  | "error"
  | "isPending"
  | "isError"
  | "isFetching"
  | "isPlaceholderData"
  | "refetch"
>

type WorkspacePreview =
  | {
      phase: "open"
      id: string
      name: string
      scope: string
      triggerId: string
    }
  | { phase: "closed"; triggerId: string }

type FileWorkspaceBrowserProps<F extends FileView, D extends FolderView> = {
  contentScopeKey: string
  workspace: { root: D; usage: FileUsageResponse }
  search: FileListQuery
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  breadcrumbs: BrowseRead<{ items: D[] }>
  entries: BrowseRead<Omit<FilePageView, "items"> & { items: (F | D)[] }>
  renderDirectory: (props: {
    root: D
    currentFolderId?: string
    ancestors: D[]
    disabled: boolean
    onOpenFolder: (folder: D) => void
  }) => ReactNode
  canCreateFolder: boolean
  canUpload: boolean
  canTrash: boolean
  canSelectActions: boolean
  navigating?: boolean
  upload: { triggerId: string; onUpload: (folder: D) => void }
  batches: {
    triggerId: string
    available: boolean
    onBatch: (
      entries: readonly (F | D)[],
      action: ExecuteFileBatch["action"]
    ) => void
  }
  creation: Pick<
    ComponentProps<typeof CreateFolderDialog>,
    "createFolder" | "readOperation" | "onCompleted"
  >
  renderEntryActions: (
    entry: F | D,
    options: { idPrefix: string; presentation: "menu" | "buttons" }
  ) => ReactNode
  renderDetailsLink: (entry: F | D) => ReactNode
  renderPreview: (
    file: Pick<F, "id" | "name">,
    onClose: () => void
  ) => ReactNode
}

export function FileWorkspaceBrowser<F extends FileView, D extends FolderView>({
  contentScopeKey,
  workspace,
  canCreateFolder,
  canUpload,
  canTrash,
  canSelectActions,
  search,
  onSearchChange,
  breadcrumbs,
  entries,
  renderDirectory,
  upload: { triggerId: uploadTriggerId, onUpload },
  batches,
  creation,
  renderEntryActions,
  renderDetailsLink,
  renderPreview,
  navigating = false,
}: FileWorkspaceBrowserProps<F, D>) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const [creatingFolder, setCreatingFolder] = useState(false)
  const creationTrigger = useRef<HTMLButtonElement | null>(null)
  // 异步文件操作可能移除原行，操作入口由工作区持有稳定身份。
  const actionScope = useId()
  const isMobile = useIsMobile()
  const [preview, setPreview] = useState<WorkspacePreview | null>(null)
  const browseScope = JSON.stringify([
    search.parentId,
    search.state,
    search.name,
  ])
  const activePreview =
    preview?.phase === "open" && preview.scope === browseScope
      ? preview
      : undefined
  const previewId = activePreview?.id
  useEffect(() => {
    if (preview?.phase === "closed") {
      // 关闭后按文件入口恢复焦点，仍允许后台操作替换过原行。
      document.getElementById(preview.triggerId)?.focus()
    }
  }, [preview])
  const trash = search.state === "trashed"
  // 切换浏览位置统一清除名称筛选和分页；排序与翻页本身保留当前预览。
  const browseTo = (
    location: Pick<FileListQuery, "parentId"> &
      Partial<Pick<FileListQuery, "state">>
  ) =>
    onSearchChange((current) => ({
      ...current,
      ...location,
      name: undefined,
      page: 1,
    }))
  if (
    fileRequestIsDenied(breadcrumbs.error) ||
    fileRequestIsDenied(entries.error)
  )
    return (
      <WorkspacePage title={t("files:title")}>
        <PermissionDeniedState />
      </WorkspacePage>
    )
  const currentFolder = breadcrumbs.data?.items.at(-1)
  const status: DataTableStatus =
    breadcrumbs.isError || entries.isError
      ? "error"
      : !currentFolder || entries.isPending
        ? entries.data
          ? "refreshing"
          : "loading"
        : navigating || breadcrumbs.isPlaceholderData || entries.isFetching
          ? "refreshing"
          : "ready"
  const folderUnavailable =
    !currentFolder || currentFolder.operationId !== null || status === "error"
  const changingFolder = navigating || breadcrumbs.isPlaceholderData
  // 请求期间只锁定操作，不将短暂等待表现为功能不可用；目录锁定或失败仍正常置灰。
  const actionClassName = folderUnavailable ? undefined : "disabled:opacity-100"
  const openLocation = (folder: D) =>
    browseTo({
      parentId:
        trash && folder.id === workspace.root.id ? undefined : folder.id,
    })
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
                className={actionClassName}
                disabled={
                  folderUnavailable ||
                  changingFolder ||
                  entries.isPlaceholderData ||
                  status === "loading"
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
                className={actionClassName}
                disabled={
                  folderUnavailable || changingFolder || status !== "ready"
                }
                onClick={() => currentFolder && onUpload(currentFolder)}
              >
                <UploadIcon />
                {t("files:uploadFiles")}
              </Button>
            )}
          </div>
        }
      >
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)] lg:grid-rows-1">
          <aside
            className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b bg-background lg:border-e lg:border-b-0"
            aria-label={t("files:directory")}
          >
            {/* details 的内容盒也会阻断 flex 布局，桌面端一并展平以约束目录滚动。 */}
            <details
              className="group lg:contents lg:[&::details-content]:contents"
              open={!isMobile}
            >
              <summary className="flex h-16 cursor-pointer items-center justify-between px-5 font-semibold lg:hidden">
                {t("files:directory")}
                <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="max-h-64 min-h-0 overflow-y-auto lg:max-h-none lg:flex-1">
                <Fragment key={contentScopeKey}>
                  {renderDirectory({
                    root: workspace.root,
                    currentFolderId: trash
                      ? undefined
                      : (search.parentId ?? workspace.root.id),
                    ancestors: trash ? [] : (breadcrumbs.data?.items ?? []),
                    disabled: false,
                    onOpenFolder: (folder) =>
                      browseTo({ state: "active", parentId: folder.id }),
                  })}
                </Fragment>
              </div>
            </details>
            <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t p-3 lg:block lg:space-y-2">
              {canTrash && (
                <Button
                  variant="ghost"
                  className={`w-full justify-start ${trash ? "bg-primary/10 text-primary" : ""}`}
                  aria-pressed={trash}
                  onClick={() =>
                    browseTo({ state: "trashed", parentId: undefined })
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
            <div className="flex min-h-12 shrink-0 items-center px-4 py-3 sm:px-5">
              {breadcrumbs.isError ? (
                <Button
                  variant="link"
                  onClick={() =>
                    browseTo({
                      parentId: trash ? undefined : workspace.root.id,
                    })
                  }
                >
                  {trash ? t("files:trash") : t("files:returnToRoot")}
                </Button>
              ) : breadcrumbs.data && currentFolder ? (
                <FileBreadcrumbNavigation
                  breadcrumbs={breadcrumbs.data}
                  currentFolder={currentFolder}
                  busy={false}
                  rootLabel={trash ? t("files:trash") : t("files:allFiles")}
                  onOpenFolder={openLocation}
                />
              ) : (
                <div role="status" aria-label={t("common:loading")}>
                  <Skeleton className="h-5 w-48" />
                </div>
              )}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col px-4 pb-5 sm:px-5 lg:min-h-0 lg:overflow-hidden">
                <FileBrowser<F, D>
                  workspace
                  previewedFileId={previewId}
                  renderEntryActions={(entry) =>
                    renderEntryActions(entry, {
                      idPrefix: `${actionScope}-row-${entry.id}`,
                      presentation: "menu",
                    })
                  }
                  contentScopeKey={contentScopeKey}
                  page={entries.data}
                  search={search}
                  status={status}
                  rootLabel={trash ? t("files:trash") : t("files:allFiles")}
                  canOpenFile={(file) => file.state === "active"}
                  renderSelectionActions={
                    canSelectActions
                      ? (selected) => {
                          const entry =
                            selected.length === 1 ? selected[0] : undefined
                          return entry ? (
                            <div className="flex flex-wrap gap-2">
                              {renderDetailsLink(entry)}
                              {renderEntryActions(entry, {
                                idPrefix: `${actionScope}-selection-${entry.id}`,
                                presentation: "buttons",
                              })}
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
                    entries.isError || breadcrumbs.isError
                      ? fileRequestErrorMessage(
                          entries.error ?? breadcrumbs.error,
                          t("common:operationFailed")
                        )
                      : undefined
                  }
                  onRetry={() =>
                    void (breadcrumbs.isError
                      ? breadcrumbs.refetch()
                      : entries.refetch())
                  }
                  onSearchChange={onSearchChange}
                  onOpenFolder={openLocation}
                  onOpenFile={(file) => {
                    setPreview({
                      phase: "open",
                      id: file.id,
                      name: file.name,
                      scope: browseScope,
                      triggerId:
                        document.activeElement instanceof HTMLElement
                          ? document.activeElement.id
                          : "",
                    })
                  }}
                  onLocate={(entry) =>
                    browseTo({ parentId: entry.parentId ?? workspace.root.id })
                  }
                />
              </div>
              {activePreview && (
                <Fragment key={contentScopeKey}>
                  {renderPreview(activePreview, () => {
                    setPreview(
                      (current) =>
                        current && {
                          phase: "closed",
                          triggerId: current.triggerId,
                        }
                    )
                  })}
                </Fragment>
              )}
            </div>
          </div>
        </div>
      </WorkspacePage>
      {currentFolder && (
        <CreateFolderDialog
          open={creatingFolder}
          contentScopeKey={contentScopeKey}
          parent={currentFolder}
          canCreate={canCreateFolder}
          onClose={() => setCreatingFolder(false)}
          returnFocus={() => creationTrigger.current}
          {...creation}
        />
      )}
    </>
  )
}

function FileUsageSummary({ usage }: { usage: FileUsageResponse }) {
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
