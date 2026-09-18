"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  type Column,
  type RowData,
  type TableState,
} from "@tanstack/react-table"
import { cn } from "cn"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  useDataTableContext,
  type DataTableFeatures,
} from "../../hooks/use-data-table"
import { useDataTablePresentation } from "./presentation"
import { DataTableEmpty } from "./empty"
import { DataTableFeedback } from "./feedback"
import type { DataTableProps } from "./types"

function selectDataTableGridState(state: TableState<DataTableFeatures>) {
  return {
    columnVisibility: state.columnVisibility,
    columnOrder: state.columnOrder,
    columnPinning: state.columnPinning,
    expanded: state.expanded,
    rowPinning: state.rowPinning,
    rowSelection: state.rowSelection,
    sorting: state.sorting,
    pagination: state.pagination,
    columnFilters: state.columnFilters,
    globalFilter: state.globalFilter,
  }
}

function getColumnStyle<TData extends RowData, TValue>(
  column: Column<DataTableFeatures, TData, TValue>
): React.CSSProperties {
  const pinned = column.getIsPinned()
  return {
    width: `${column.getSize()}px`,
    position: pinned ? "sticky" : "relative",
    insetInlineStart:
      pinned === "start" ? `${column.getStart("start")}px` : undefined,
    insetInlineEnd:
      pinned === "end" ? `${column.getAfter("end")}px` : undefined,
    zIndex: pinned ? 10 : undefined,
  }
}

type DataTableContentProps<TData extends RowData> = {
  hasFilters: boolean
  onResetFilters: () => void
  empty?: React.ReactNode
  error?: string
  onRetry?: () => void
  renderExpandedRow?: DataTableProps<TData>["renderExpandedRow"]
}

export function DataTableContent<TData extends RowData>(
  props: DataTableContentProps<TData>
) {
  const table = useDataTableContext<TData>()
  return (
    <table.Subscribe selector={selectDataTableGridState}>
      {(gridState) => <DataTableGrid gridState={gridState} {...props} />}
    </table.Subscribe>
  )
}

function DataTableGrid<TData extends RowData>({
  gridState,
  hasFilters,
  onResetFilters,
  empty,
  error,
  onRetry,
  renderExpandedRow,
}: DataTableContentProps<TData> & {
  gridState: ReturnType<typeof selectDataTableGridState>
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext<TData>()
  const { status, isActionPending } = useDataTablePresentation()
  const isLoading = status === "loading"
  const rows = [
    ...table.getTopRows(),
    ...table.getCenterRows(),
    ...table.getBottomRows(),
  ]
  const visibleColumns = table.getVisibleLeafColumns()
  const columnCount = Math.max(visibleColumns.length, 1)
  const skeletonRows = Math.min(gridState.pagination.pageSize, 10)

  return (
    <div
      data-slot="data-table-content"
      className="overflow-x-auto rounded-2xl border"
    >
      <table
        data-slot="table"
        aria-busy={isLoading || status === "refreshing" || isActionPending}
        className="w-full table-fixed caption-bottom text-sm"
        style={{ minWidth: `${table.getTotalSize()}px` }}
      >
        <colgroup>
          {visibleColumns.map((column) => (
            <col key={column.id} style={{ width: `${column.getSize()}px` }} />
          ))}
        </colgroup>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getCanSort()
                  ? header.column.getIsSorted()
                  : undefined

                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={getColumnStyle(header.column)}
                    className="bg-background"
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : sorted === false
                            ? "none"
                            : undefined
                    }
                  >
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {status === "error" && table.options.data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="whitespace-normal">
                <DataTableFeedback
                  status={status}
                  error={error}
                  onRetry={onRetry}
                  isActionPending={isActionPending}
                  hasData={false}
                />
              </TableCell>
            </TableRow>
          ) : visibleColumns.length === 0 ? (
            <TableRow>
              <TableCell className="p-8 text-center whitespace-normal">
                <p role="status" className="mb-3">
                  {t("tableNoColumns")}
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    // 初始配置也可能全部隐藏，恢复时必须直接显示所有列。
                    table.resetColumnVisibility(true)
                  }}
                >
                  {t("resetColumns")}
                </Button>
              </TableCell>
            </TableRow>
          ) : isLoading ? (
            Array.from({ length: skeletonRows }, (_, index) => (
              <TableRow key={index} className="hover:bg-transparent">
                {Array.from({ length: columnCount }, (_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) =>
                    (() => {
                      const allowCellOverflow =
                        cell.column.columnDef.meta?.allowCellOverflow === true

                      return (
                        <TableCell
                          key={cell.id}
                          style={getColumnStyle(cell.column)}
                          className={cn(
                            allowCellOverflow
                              ? "overflow-visible"
                              : "overflow-hidden",
                            cell.column.getIsPinned() && "bg-background",
                            row.getIsSelected() &&
                              cell.column.getIsPinned() &&
                              "bg-muted"
                          )}
                        >
                          <div className={cn(!allowCellOverflow && "truncate")}>
                            <table.FlexRender cell={cell} />
                          </div>
                        </TableCell>
                      )
                    })()
                  )}
                </TableRow>
                {row.getIsExpanded() && renderExpandedRow ? (
                  <TableRow>
                    <TableCell
                      colSpan={columnCount}
                      className="bg-muted/30 p-4 whitespace-normal"
                    >
                      {renderExpandedRow(row)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount} className="whitespace-normal">
                <DataTableEmpty
                  empty={empty}
                  hasFilters={hasFilters}
                  onResetFilters={onResetFilters}
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </table>
    </div>
  )
}
