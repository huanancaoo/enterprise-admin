import type {
  FileEntryView,
  FolderView,
  FileView,
  FileBreadcrumbsView,
  FilePageView,
} from "./types"
import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import type { RowSelectionState } from "@tanstack/react-table"
import type { FileListQuery } from "@workspace/contracts"
import { PermissionDeniedState } from "@workspace/admin"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  createDataTableSelectColumn,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { ChevronRightIcon, MapPinIcon } from "lucide-react"
import { FileEntryIcon } from "./file-presentation"
import { fileTypeLabel, formatFileSize } from "./file-format"
import { FileSearch } from "./file-search"

const columnHelper = createDataTableColumnHelper<FileEntryView>()
const emptyEntries: FileEntryView[] = []

type BrowserNavigation<D extends FolderView> =
  | { workspace: true; currentFolder?: never; breadcrumbs?: never }
  | { workspace?: false; currentFolder: D; breadcrumbs: { items: D[] } }

type BaseFileBrowserProps = {
  contentScopeKey: string
  page?: FilePageView
  search: FileListQuery
  status: DataTableStatus
  error?: string
  isActionPending?: boolean
  onRetry?: () => void
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFolder: (folder: FolderView) => void
  onOpenFile: (file: FileView) => void
  canOpenFile?: (file: FileView) => boolean
  onLocate?: (entry: FileEntryView) => void
  actions?: ReactNode
  renderSelectionActions?: (entries: FileEntryView[]) => ReactNode
  rootLabel?: string
  previewedFileId?: string
  renderEntryActions?: (entry: FileEntryView) => ReactNode
} & BrowserNavigation<FolderView>

type BrowserCellState = Pick<
  BaseFileBrowserProps,
  | "onOpenFolder"
  | "onOpenFile"
  | "canOpenFile"
  | "onLocate"
  | "renderEntryActions"
  | "previewedFileId"
  | "search"
> & { busy: boolean; buttonId: string }
const BrowserCellContext = createContext<BrowserCellState | null>(null)
type EntryCellProps = { row: { original: FileEntryView } }

// 单元格组件身份不随预览或请求状态变化，键盘焦点和行内菜单才能连续保留。
function FileNameCell({ row: { original: entry } }: EntryCellProps) {
  const state = useContext(BrowserCellContext)!
  return (
    <Button
      id={`${state.buttonId}-${entry.id}`}
      variant="link"
      aria-current={entry.id === state.previewedFileId ? true : undefined}
      className="h-auto max-w-full min-w-0 justify-start gap-3 p-0 text-start font-normal text-foreground hover:no-underline"
      title={entry.name}
      disabled={
        state.busy ||
        (entry.kind === "file" && state.canOpenFile?.(entry) === false)
      }
      onClick={() =>
        entry.kind === "folder"
          ? state.onOpenFolder(entry)
          : state.onOpenFile(entry)
      }
    >
      <FileEntryIcon entry={entry} />
      <span className="truncate">{entry.name}</span>
    </Button>
  )
}

function FileLocationCell({ row: { original: entry } }: EntryCellProps) {
  const { t } = useTranslation("files")
  const { search, onLocate, busy } = useContext(BrowserCellContext)!
  const parentPath = entry.path.slice(0, -1).join(" / ") || t("root")
  return search.state === "active" && search.name && onLocate ? (
    <Button
      variant="link"
      className="h-auto max-w-full min-w-0 justify-start p-0 text-start"
      disabled={busy}
      title={parentPath}
      onClick={() => onLocate(entry)}
    >
      <MapPinIcon aria-hidden="true" className="shrink-0" />
      <span className="truncate">{parentPath}</span>
    </Button>
  ) : (
    <span className="block truncate" title={parentPath}>
      {parentPath}
    </span>
  )
}

function FileActionsCell({ row }: EntryCellProps) {
  const { busy, renderEntryActions } = useContext(BrowserCellContext)!
  return (
    <fieldset disabled={busy} className="contents">
      {renderEntryActions?.(row.original)}
    </fieldset>
  )
}

function Browser(props: BaseFileBrowserProps) {
  const {
    contentScopeKey,
    page,
    search,
    status,
    error,
    isActionPending = false,
    onRetry,
    onSearchChange,
    onOpenFolder,
    onOpenFile,
    canOpenFile,
    onLocate,
    actions,
    renderSelectionActions,
    rootLabel,
    workspace = false,
    previewedFileId,
    renderEntryActions,
  } = props
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const buttonId = useId()
  const busy = status !== "ready" || isActionPending
  const hasSelectionActions = Boolean(renderSelectionActions)
  const hasEntryActions = Boolean(renderEntryActions)
  const selectionScope = JSON.stringify([
    contentScopeKey,
    search.parentId,
    search.state,
  ])
  const [selection, setSelection] = useState<{
    scope: string
    rows: RowSelectionState
  }>({ scope: selectionScope, rows: {} })
  if (selection.scope !== selectionScope) {
    // 只清理跨目录的选择，不用重挂整张表来丢弃旧目录中的操作对象。
    setSelection({ scope: selectionScope, rows: {} })
  }
  const showPath =
    !workspace || Boolean(search.name) || search.state === "trashed"
  const [visibility, setVisibility] = useState<{
    showPath: boolean
    columns: Record<string, boolean>
  }>({ showPath, columns: { path: showPath } })
  if (visibility.showPath !== showPath) {
    setVisibility({
      showPath,
      columns: { ...visibility.columns, path: showPath },
    })
  }
  const columns = useMemo(
    () =>
      columnHelper.columns([
        ...(hasSelectionActions
          ? [createDataTableSelectColumn<FileEntryView>()]
          : []),
        columnHelper.accessor("name", {
          header: ({ header }) => (
            <DataTableColumnHeader header={header} title={t("files:name")} />
          ),
          meta: { label: t("files:name") },
          size: workspace ? 190 : 300,
          cell: FileNameCell,
        }),
        columnHelper.accessor("kind", {
          header: t("files:type"),
          meta: { label: t("files:type") },
          enableSorting: false,
          size: workspace ? 70 : 150,
          cell: ({ row }) =>
            row.original.kind === "folder" ? (
              t("files:folder")
            ) : (
              <span title={row.original.currentVersion.contentType}>
                {workspace
                  ? fileTypeLabel(row.original)
                  : row.original.currentVersion.contentType}
              </span>
            ),
        }),
        columnHelper.accessor(
          (entry) =>
            entry.kind === "file" ? entry.currentVersion.bytes : null,
          {
            id: "size",
            header: ({ header }) => (
              <DataTableColumnHeader header={header} title={t("files:size")} />
            ),
            meta: { label: t("files:size") },
            size: workspace ? 90 : 150,
            cell: ({ row }) =>
              row.original.kind === "file"
                ? workspace
                  ? formatFileSize(row.original.currentVersion.bytes, locale)
                  : t("files:byteCount", {
                      bytes: createFormatter(locale).number(
                        row.original.currentVersion.bytes
                      ),
                    })
                : t("files:folderSize"),
          }
        ),
        columnHelper.accessor("updatedAt", {
          header: ({ header }) => (
            <DataTableColumnHeader
              header={header}
              title={t("files:updatedAt")}
            />
          ),
          meta: { label: t("files:updatedAt") },
          size: workspace ? 110 : 150,
          cell: (cell) =>
            workspace ? (
              <time
                dateTime={cell.getValue()}
                title={createFormatter(locale).dateTime(
                  new Date(cell.getValue()),
                  "UTC"
                )}
              >
                {new Intl.DateTimeFormat(locale, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  timeZone: "UTC",
                }).format(new Date(cell.getValue()))}
              </time>
            ) : (
              createFormatter(locale).dateTime(new Date(cell.getValue()), "UTC")
            ),
        }),
        columnHelper.accessor("path", {
          header: t(
            search.state === "trashed"
              ? "files:originalLocation"
              : "files:location"
          ),
          meta: {
            label: t(
              search.state === "trashed"
                ? "files:originalLocation"
                : "files:location"
            ),
          },
          enableSorting: false,
          cell: FileLocationCell,
        }),
        ...(hasEntryActions
          ? [
              columnHelper.display({
                id: "actions",
                header: () => (
                  <span className="sr-only">{t("files:detail")}</span>
                ),
                size: 64,
                enableHiding: false,
                meta: { allowCellOverflow: true },
                cell: FileActionsCell,
              }),
            ]
          : []),
        ...(search.state === "trashed"
          ? [
              columnHelper.accessor("deletedAt", {
                header: t("files:deletedAt"),
                enableSorting: false,
                cell: (cell) =>
                  cell.getValue()
                    ? createFormatter(locale).dateTime(
                        new Date(cell.getValue()!),
                        "UTC"
                      )
                    : t("files:folderSize"),
              }),
              columnHelper.accessor("expiresAt", {
                header: t("files:expiresAt"),
                enableSorting: false,
                cell: (cell) =>
                  cell.getValue()
                    ? createFormatter(locale).dateTime(
                        new Date(cell.getValue()!),
                        "UTC"
                      )
                    : t("files:noExpiry"),
              }),
            ]
          : []),
      ]),
    [hasSelectionActions, hasEntryActions, locale, search.state, t, workspace]
  )
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]

  if (status === "forbidden") return <PermissionDeniedState />

  return (
    <BrowserCellContext
      value={{
        busy,
        buttonId,
        onOpenFolder,
        onOpenFile,
        canOpenFile,
        onLocate,
        renderEntryActions,
        previewedFileId,
        search,
      }}
    >
      <div
        className={
          workspace
            ? "min-w-0 space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-0"
            : "min-w-0 space-y-4"
        }
      >
        {!props.workspace && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BreadcrumbNavigation
              breadcrumbs={props.breadcrumbs}
              currentFolder={props.currentFolder}
              busy={busy}
              onOpenFolder={onOpenFolder}
              rootLabel={rootLabel}
            />
            {actions}
          </div>
        )}
        {search.name && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("files:organizationSearch", { name: search.name })}
          </p>
        )}
        <DataTable
          key={contentScopeKey}
          showSearch={!workspace}
          initialState={
            workspace
              ? { columnPinning: { start: [], end: ["actions"] } }
              : undefined
          }
          toolbarFilters={
            workspace && (
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
            )
          }
          rowClassName={(row) =>
            row.original.id === previewedFileId
              ? "bg-primary/5 shadow-[inset_2px_0_0_var(--color-primary)] rtl:shadow-[inset_-2px_0_0_var(--color-primary)]"
              : undefined
          }
          className={
            workspace
              ? "relative before:absolute before:inset-x-0 before:-top-1.5 before:h-0.5 before:bg-primary/50 before:opacity-0 aria-busy:before:opacity-100 *:data-[slot=data-table-progress]:sr-only lg:min-h-0 lg:flex-1 lg:*:data-[slot=data-table-frame]:min-h-0 lg:*:data-[slot=data-table-frame]:flex-1 lg:[&_[data-slot=data-table-content]]:h-full [&_td]:h-14 [&_td]:text-foreground/80 lg:[&_thead]:sticky lg:[&_thead]:top-0 lg:[&_thead]:z-20"
              : undefined
          }
          columns={columns}
          data={page?.items ?? emptyEntries}
          getRowId={(entry) => entry.id}
          rowCount={page?.total ?? 0}
          status={status}
          error={error}
          isActionPending={isActionPending}
          onRetry={onRetry}
          manualPagination
          manualFiltering
          manualSorting
          enableMultiSort={false}
          searchPlaceholder={t("files:searchPlaceholder")}
          state={{
            rowSelection:
              selection.scope === selectionScope ? selection.rows : {},
            columnVisibility: visibility.columns,
            globalFilter: search.name ?? "",
            pagination: {
              pageIndex: search.page - 1,
              pageSize: search.pageSize,
            },
            sorting,
          }}
          onRowSelectionChange={(updater) =>
            setSelection((current) => ({
              scope: selectionScope,
              rows:
                typeof updater === "function"
                  ? updater(
                      current.scope === selectionScope ? current.rows : {}
                    )
                  : updater,
            }))
          }
          onColumnVisibilityChange={(updater) =>
            setVisibility((current) => ({
              ...current,
              columns:
                typeof updater === "function"
                  ? updater(current.columns)
                  : updater,
            }))
          }
          onGlobalFilterChange={(updater) => {
            const value =
              typeof updater === "function"
                ? updater(search.name ?? "")
                : updater
            const name = typeof value === "string" ? value.trim() : ""
            onSearchChange((current) => ({
              ...current,
              name: name || undefined,
              page: 1,
            }))
          }}
          onPaginationChange={(updater) => {
            const previous = {
              pageIndex: search.page - 1,
              pageSize: search.pageSize,
            }
            const next =
              typeof updater === "function" ? updater(previous) : updater
            onSearchChange((current) => ({
              ...current,
              page: next.pageSize === current.pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            }))
          }}
          onSortingChange={(updater) => {
            const next =
              typeof updater === "function" ? updater(sorting) : updater
            const sort = next[0]
            onSearchChange((current) => ({
              ...current,
              page: 1,
              sortBy:
                sort?.id === "size"
                  ? "size"
                  : sort?.id === "updatedAt"
                    ? "updatedAt"
                    : "name",
              sortOrder: sort?.desc ? "desc" : "asc",
            }))
          }}
          onResetFilters={() =>
            onSearchChange((current) => ({
              ...current,
              name: undefined,
              page: 1,
            }))
          }
          renderSelectionActions={
            renderSelectionActions
              ? (rows) =>
                  renderSelectionActions(rows.map((row) => row.original))
              : undefined
          }
          empty={
            <p className="text-sm text-muted-foreground">
              {search.name
                ? t("files:noSearchResults")
                : search.state === "trashed" && search.parentId === undefined
                  ? t("files:emptyTrash")
                  : t("files:emptyFolder")}
            </p>
          }
        />
      </div>
    </BrowserCellContext>
  )
}

function BreadcrumbNavigation({
  breadcrumbs,
  currentFolder,
  busy,
  onOpenFolder,
  rootLabel,
}: {
  breadcrumbs: FileBreadcrumbsView
  currentFolder: FolderView
  onOpenFolder: (folder: FolderView) => void
  rootLabel?: string
  busy: boolean
}) {
  const { t } = useTranslation("files")
  return (
    <nav aria-label={t("folderNavigation")}>
      <ol className="flex flex-wrap items-center gap-2">
        {breadcrumbs.items.map((folder, index) => (
          <li key={folder.id} className="flex min-w-0 items-center gap-2">
            {index > 0 && (
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
              />
            )}
            <Button
              variant="link"
              className="h-auto max-w-full p-0 text-start [overflow-wrap:anywhere] whitespace-normal text-muted-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
              disabled={busy}
              aria-current={folder.id === currentFolder.id ? "page" : undefined}
              onClick={() => onOpenFolder(folder)}
            >
              {folder.parentId === null
                ? (rootLabel ?? t("root"))
                : folder.name}
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

// 浏览器只返回输入集合里的条目；泛型保留调用方的归属字段，不生成任何归属身份。
export type FileBrowserProps<
  F extends FileView = FileView,
  D extends FolderView = FolderView,
> = Omit<
  BaseFileBrowserProps,
  | "workspace"
  | "currentFolder"
  | "breadcrumbs"
  | "page"
  | "onOpenFolder"
  | "onOpenFile"
  | "canOpenFile"
  | "onLocate"
  | "renderSelectionActions"
  | "renderEntryActions"
> & {
  workspace?: false
  currentFolder: D
  breadcrumbs: { items: D[] }
  page?: Omit<FilePageView, "items"> & { items: (F | D)[] }
  onOpenFolder: (folder: D) => void
  onOpenFile: (file: F) => void
  canOpenFile?: (file: F) => boolean
  onLocate?: (entry: F | D) => void
  renderSelectionActions?: (entries: (F | D)[]) => ReactNode
  renderEntryActions?: (entry: F | D) => ReactNode
}
export const FileBrowser = Browser as <
  F extends FileView = FileView,
  D extends FolderView = FolderView,
>(
  props:
    | FileBrowserProps<F, D>
    | (Omit<
        FileBrowserProps<F, D>,
        "workspace" | "currentFolder" | "breadcrumbs"
      > & {
        workspace: true
      })
) => ReturnType<typeof Browser>
export const FileBreadcrumbNavigation = BreadcrumbNavigation as <
  D extends FolderView = FolderView,
>(props: {
  breadcrumbs: { items: D[] }
  currentFolder: D
  onOpenFolder: (folder: D) => void
  rootLabel?: string
  busy: boolean
}) => ReturnType<typeof BreadcrumbNavigation>
