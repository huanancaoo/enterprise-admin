"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { useUiLocale } from "@workspace/i18n/react"
import { localeMeta } from "@workspace/i18n"
import type { RowData } from "@tanstack/react-table"
import { cn } from "cn"
import { Button } from "@workspace/ui/components/button"
import { useDataTable } from "../hooks/use-data-table"
import { configureColumns } from "../lib/data-table-columns"
import { Pagination } from "./pagination"
import { DataTableContent } from "./data-table/content"
import {
  DataTableToolbar,
  DataTableSearch,
  DataTableFacetedFilter,
} from "./data-table/toolbar"
import { DataTableSelectionActions } from "./data-table/selection"
import { DataTablePresentationContext } from "./data-table/presentation"
import { DataTableFeedback } from "./data-table/feedback"
import { DataTableEmpty } from "./data-table/empty"
import type { DataTableProps } from "./data-table/types"

export type { DataTableProps, DataTableStatus } from "./data-table/types"
export { DataTableColumnHeader } from "./data-table/column-header"

export function DataTable<TData extends RowData>({
  columns,
  data,
  searchPlaceholder,
  showSearch = true,
  className,
  status = "ready",
  error,
  onRetry,
  onResetFilters,
  isActionPending = false,
  empty,
  initialState,
  renderSelectionActions,
  renderExpandedRow,
  ...options
}: DataTableProps<TData>) {
  const { t } = useTranslation("common")
  const locale = useUiLocale()
  const configuredColumns = React.useMemo(
    () => configureColumns(columns),
    [columns]
  )
  const table = useDataTable({
    columns: configuredColumns,
    // 无权限时不把缓存数据交给行模型，选择、展开和固定行也不能泄漏旧内容。
    data: status === "forbidden" ? [] : data,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 10 },
      ...initialState,
    },
    ...options,
    columnResizeDirection: localeMeta[locale].direction,
  })
  const searchValue = (table.state.globalFilter as string | undefined) ?? ""
  const hasFilters =
    Boolean(searchValue) || table.state.columnFilters.length > 0
  const selectionScope = JSON.stringify([
    status === "forbidden",
    ...(options.manualPagination
      ? [
          table.state.pagination,
          table.state.columnFilters,
          searchValue,
          table.state.sorting,
        ]
      : []),
  ])
  const previousScope = React.useRef(selectionScope)
  const resetRowSelection = table.resetRowSelection
  React.useLayoutEffect(() => {
    if (previousScope.current !== selectionScope) {
      // 服务端只提供当前页实体，不能把上一页的 ID 当作完整的跨页操作对象。
      resetRowSelection(true)
      previousScope.current = selectionScope
    }
  }, [selectionScope, resetRowSelection])

  const clearFilters = () => {
    if (options.manualFiltering) {
      onResetFilters!()
    } else {
      table.resetGlobalFilter(true)
      table.resetColumnFilters(true)
    }
  }
  const busy =
    status === "loading" || status === "refreshing" || isActionPending
  const rowsDisabled = status !== "ready" || isActionPending
  const showSelection =
    (status === "ready" || isActionPending) &&
    table.getFilteredSelectedRowModel().rows.length > 0
  const isCollectionEmpty =
    status === "ready" && table.getRowCount() === 0 && !hasFilters

  return (
    <table.AppTable>
      <DataTablePresentationContext
        value={{ status, isActionPending, rowsDisabled }}
      >
        <fieldset
          data-slot="data-table"
          disabled={isActionPending}
          aria-busy={busy}
          className={cn("flex min-w-0 flex-col gap-4", className)}
        >
          {(status !== "error" || data.length > 0) && (
            <DataTableFeedback
              status={status}
              error={error}
              onRetry={onRetry}
              isActionPending={isActionPending}
              hasData={data.length > 0}
            />
          )}
          {status !== "forbidden" && !isCollectionEmpty && (
            <DataTableToolbar>
              {showSelection ? (
                <DataTableSelectionActions<TData>
                  renderActions={renderSelectionActions}
                />
              ) : (
                <>
                  {showSearch && (
                    <DataTableSearch
                      key={searchValue}
                      value={searchValue}
                      placeholder={searchPlaceholder}
                    />
                  )}
                  {table
                    .getAllLeafColumns()
                    .map((column) =>
                      column.columnDef.meta?.facetOptions ? (
                        <DataTableFacetedFilter
                          key={column.id}
                          column={column}
                          options={column.columnDef.meta.facetOptions}
                        />
                      ) : null
                    )}
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      {t("clearFilters")}
                    </Button>
                  )}
                </>
              )}
            </DataTableToolbar>
          )}
          {status !== "forbidden" &&
            (isCollectionEmpty ? (
              <DataTableEmpty
                empty={empty}
                hasFilters={false}
                onResetFilters={clearFilters}
              />
            ) : (
              <DataTableContent
                empty={empty}
                error={error}
                onRetry={onRetry}
                renderExpandedRow={renderExpandedRow}
                hasFilters={hasFilters}
                onResetFilters={clearFilters}
              />
            ))}
          {status !== "forbidden" &&
            (table.getRowCount() > 0 || status === "loading") && (
              <Pagination
                pageIndex={table.state.pagination.pageIndex}
                pageSize={table.state.pagination.pageSize}
                rowCount={table.getRowCount()}
                pageCount={table.getPageCount()}
                disabled={status === "loading" || isActionPending}
                isLoading={status === "loading"}
                onPageChange={(index) => table.setPageIndex(index)}
                onPageSizeChange={(size) => table.setPageSize(size)}
              />
            )}
        </fieldset>
      </DataTablePresentationContext>
    </table.AppTable>
  )
}
