import type { Column, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../hooks/use-data-table"
import type { DataTableOptions } from "../components/data-table/types"

export function configureColumns<TData extends RowData>(
  columns: DataTableOptions<TData>["columns"]
): DataTableOptions<TData>["columns"] {
  return columns.map((column) => ({
    ...column,
    // 分组列也从叶子列的选项生成筛选，调用方无需重复指定筛选算法。
    ...("columns" in column && column.columns
      ? { columns: configureColumns(column.columns) }
      : {}),
    ...(column.meta?.facetOptions
      ? {
          filterFn:
            column.meta.facetMode === "single"
              ? ("equalsString" as const)
              : ("arrHas" as const),
        }
      : {}),
  }))
}

export function getColumnLabel<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>
) {
  if (column.columnDef.meta?.label) {
    return column.columnDef.meta.label
  }
  if (typeof column.columnDef.header === "string") {
    return column.columnDef.header
  }
  return column.id
}
