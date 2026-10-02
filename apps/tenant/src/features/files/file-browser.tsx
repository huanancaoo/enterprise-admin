import { useId, useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type {
  FileBreadcrumbs,
  FileEntryResponse,
  FileListQuery,
  FilePage,
  FileResponse,
  FolderResponse,
} from "@workspace/contracts"
import {
  DataTable,
  DataTableColumnHeader,
  PermissionDeniedState,
  createDataTableColumnHelper,
  createDataTableSelectColumn,
  type DataTableStatus,
} from "@workspace/admin"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { FileIcon, FolderIcon, MapPinIcon } from "lucide-react"

const columnHelper = createDataTableColumnHelper<FileEntryResponse>()
const emptyEntries: FileEntryResponse[] = []

export type FileBrowserProps = {
  contentScopeKey: string
  currentFolder: FolderResponse
  breadcrumbs: FileBreadcrumbs
  page?: FilePage
  search: FileListQuery
  status: DataTableStatus
  error?: string
  isActionPending?: boolean
  onRetry?: () => void
  onSearchChange: (updater: (current: FileListQuery) => FileListQuery) => void
  onOpenFolder: (folder: FolderResponse) => void
  onOpenFile: (file: FileResponse) => void
  canOpenFile?: (file: FileResponse) => boolean
  onLocate?: (entry: FileEntryResponse) => void
  actions?: ReactNode
  renderSelectionActions?: (entries: FileEntryResponse[]) => ReactNode
}

export function FileBrowser({
  contentScopeKey,
  currentFolder,
  breadcrumbs,
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
}: FileBrowserProps) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const buttonId = useId()
  const busy = status !== "ready" || isActionPending
  const columns = useMemo(
    () =>
      columnHelper.columns([
        ...(renderSelectionActions
          ? [createDataTableSelectColumn<FileEntryResponse>()]
          : []),
        columnHelper.accessor("name", {
          header: ({ header }) => (
            <DataTableColumnHeader header={header} title={t("files:name")} />
          ),
          meta: { label: t("files:name") },
          size: 300,
          cell: ({ row }) => {
            const entry = row.original
            return (
              <Button
                id={`${buttonId}-${entry.id}`}
                variant="link"
                className="h-auto max-w-full min-w-0 justify-start p-0 text-start [overflow-wrap:anywhere] whitespace-normal"
                title={entry.name}
                disabled={
                  busy ||
                  (entry.kind === "file" && canOpenFile?.(entry) === false)
                }
                onClick={() =>
                  entry.kind === "folder"
                    ? onOpenFolder(entry)
                    : onOpenFile(entry)
                }
              >
                {entry.kind === "folder" ? (
                  <FolderIcon aria-hidden="true" className="shrink-0" />
                ) : (
                  <FileIcon aria-hidden="true" className="shrink-0" />
                )}
                {entry.name}
              </Button>
            )
          },
        }),
        columnHelper.accessor("kind", {
          header: t("files:type"),
          meta: { label: t("files:type") },
          enableSorting: false,
          cell: ({ row }) =>
            row.original.kind === "folder"
              ? t("files:folder")
              : row.original.currentVersion.contentType,
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
            cell: ({ row }) =>
              row.original.kind === "file"
                ? t("files:byteCount", {
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
          cell: (cell) =>
            createFormatter(locale).dateTime(new Date(cell.getValue()), "UTC"),
        }),
        columnHelper.accessor("path", {
          header: t("files:location"),
          meta: { label: t("files:location") },
          enableSorting: false,
          cell: ({ row }) => {
            const entry = row.original
            const parentPath =
              entry.path.slice(0, -1).join(" / ") || t("files:root")
            return search.name && onLocate ? (
              <Button
                variant="link"
                className="h-auto max-w-full p-0 text-start [overflow-wrap:anywhere] whitespace-normal"
                disabled={busy}
                title={parentPath}
                onClick={() => onLocate(entry)}
              >
                <MapPinIcon aria-hidden="true" className="shrink-0" />
                {parentPath}
              </Button>
            ) : (
              <span className="[overflow-wrap:anywhere]">{parentPath}</span>
            )
          },
        }),
      ]),
    [
      buttonId,
      busy,
      canOpenFile,
      locale,
      onLocate,
      onOpenFile,
      onOpenFolder,
      renderSelectionActions,
      search.name,
      t,
    ]
  )
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]

  if (status === "forbidden") return <PermissionDeniedState />

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("files:folderNavigation")}>
          <ol className="flex flex-wrap items-center gap-2">
            {breadcrumbs.items.map((folder, index) => (
              <li key={folder.id} className="flex min-w-0 items-center gap-2">
                {index > 0 && <span aria-hidden="true">/</span>}
                <Button
                  variant="link"
                  className="h-auto max-w-full p-0 text-start [overflow-wrap:anywhere] whitespace-normal"
                  disabled={busy}
                  aria-current={
                    folder.id === currentFolder.id ? "page" : undefined
                  }
                  onClick={() => onOpenFolder(folder)}
                >
                  {folder.parentId === null ? t("files:root") : folder.name}
                </Button>
              </li>
            ))}
          </ol>
        </nav>
        {actions}
      </div>
      {search.name && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("files:organizationSearch", { name: search.name })}
        </p>
      )}
      <DataTable
        key={JSON.stringify([contentScopeKey, currentFolder.id, search.state])}
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
          globalFilter: search.name ?? "",
          pagination: { pageIndex: search.page - 1, pageSize: search.pageSize },
          sorting,
        }}
        onGlobalFilterChange={(updater) => {
          const value =
            typeof updater === "function" ? updater(search.name ?? "") : updater
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
            ? (rows) => renderSelectionActions(rows.map((row) => row.original))
            : undefined
        }
        empty={
          <p className="text-sm text-muted-foreground">
            {search.name ? t("files:noSearchResults") : t("files:emptyFolder")}
          </p>
        }
      />
    </div>
  )
}
