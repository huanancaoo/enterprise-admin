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
  rootLabel?: string
  workspace?: boolean
  previewedFileId?: string
  renderEntryActions?: (entry: FileEntryResponse) => ReactNode
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
  rootLabel,
  workspace = false,
  previewedFileId,
  renderEntryActions,
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
          size: workspace ? 190 : 300,
          cell: ({ row }) => {
            const entry = row.original
            return (
              <Button
                id={`${buttonId}-${entry.id}`}
                variant="link"
                aria-current={entry.id === previewedFileId ? true : undefined}
                className="h-auto max-w-full min-w-0 justify-start gap-3 p-0 text-start font-normal [overflow-wrap:anywhere] whitespace-normal text-foreground hover:no-underline"
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
                <FileEntryIcon entry={entry} />
                {entry.name}
              </Button>
            )
          },
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
          cell: ({ row }) => {
            const entry = row.original
            const parentPath =
              entry.path.slice(0, -1).join(" / ") || t("files:root")
            return search.state === "active" && search.name && onLocate ? (
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
        ...(renderEntryActions
          ? [
              columnHelper.display({
                id: "actions",
                header: () => (
                  <span className="sr-only">{t("files:detail")}</span>
                ),
                size: 64,
                enableHiding: false,
                meta: { allowCellOverflow: true },
                cell: ({ row }) => renderEntryActions(row.original),
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
      search.state,
      t,
      workspace,
      previewedFileId,
      renderEntryActions,
    ]
  )
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]

  if (status === "forbidden") return <PermissionDeniedState />

  return (
    <div className="min-w-0 space-y-4">
      {!workspace && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FileBreadcrumbNavigation
            breadcrumbs={breadcrumbs}
            currentFolder={currentFolder}
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
        key={JSON.stringify([
          contentScopeKey,
          currentFolder.id,
          search.state,
          Boolean(search.name),
        ])}
        showSearch={!workspace}
        initialState={{
          columnVisibility: {
            path:
              !workspace || Boolean(search.name) || search.state === "trashed",
          },
        }}
        toolbarContent={
          workspace ? (
            <h2 className="min-w-0 text-lg font-semibold wrap-anywhere">
              {currentFolder.parentId === null
                ? (rootLabel ?? t("files:allFiles"))
                : currentFolder.name}
              <span className="ms-3 text-sm font-normal text-muted-foreground">
                {page ? t("files:itemCount", { quantity: page.total }) : ""}
              </span>
            </h2>
          ) : undefined
        }
        rowClassName={(row) =>
          row.original.id === previewedFileId
            ? "bg-primary/5 shadow-[inset_2px_0_0_var(--color-primary)] rtl:shadow-[inset_-2px_0_0_var(--color-primary)]"
            : undefined
        }
        className={
          workspace
            ? "gap-0 [&_[data-slot=data-table-content]]:rounded-none [&_[data-slot=data-table-content]]:border-0 [&_[data-slot=data-table-toolbar]]:px-4 [&_[data-slot=data-table-toolbar]]:py-4 [&_td]:h-16 [&_td]:px-3 [&_td]:text-foreground/70 [&_th]:bg-background [&_th]:px-3 [&>div:last-child]:px-4 [&>div:last-child]:py-4"
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
            {search.name
              ? t("files:noSearchResults")
              : search.state === "trashed" && search.parentId === undefined
                ? t("files:emptyTrash")
                : t("files:emptyFolder")}
          </p>
        }
      />
    </div>
  )
}

export function FileBreadcrumbNavigation({
  breadcrumbs,
  currentFolder,
  busy,
  onOpenFolder,
  rootLabel,
}: Pick<
  FileBrowserProps,
  "breadcrumbs" | "currentFolder" | "onOpenFolder" | "rootLabel"
> & { busy: boolean }) {
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
              className="h-auto max-w-full p-0 text-start [overflow-wrap:anywhere] whitespace-normal"
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
