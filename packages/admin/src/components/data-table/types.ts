import type { ReactNode } from "react"
import type { Row, RowData, TableOptions } from "@tanstack/react-table"
import type { DataTableFeatures } from "../../hooks/use-data-table"

export type DataTableStatus =
  "ready" | "loading" | "refreshing" | "error" | "forbidden"

export type DataTableOptions<TData extends RowData> = Omit<
  TableOptions<DataTableFeatures, TData>,
  "features" | "columnResizeDirection" | "manualFiltering" | "getRowId"
>

export type DataTableProps<TData extends RowData> = DataTableOptions<TData> & {
  getRowId: NonNullable<TableOptions<DataTableFeatures, TData>["getRowId"]>
  className?: string
  showSearch?: boolean
  searchPlaceholder?: string
  status?: DataTableStatus
  error?: string
  onRetry?: () => void
  /** 批量操作由调用方执行；进行中冻结条件、选择和行操作，保持操作对象不变。 */
  isActionPending?: boolean
  /** 仅用于数据集为空；筛选无结果与越界空页由表格分别呈现。 */
  empty?: ReactNode
  renderExpandedRow?: (row: Row<DataTableFeatures, TData>) => ReactNode
  /** 本地数据为筛选后跨页选中行；manualPagination 时仅为当前页选中行。 */
  renderSelectionActions?: (rows: Row<DataTableFeatures, TData>[]) => ReactNode
} & (
    | { manualFiltering: true; onResetFilters: () => void }
    | { manualFiltering?: false; onResetFilters?: never }
  )
