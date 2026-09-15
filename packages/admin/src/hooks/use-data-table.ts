"use client"

import type { ComponentType } from "react"
import {
  columnSizingFeature,
  columnResizingFeature,
  columnPinningFeature,
  columnOrderingFeature,
  rowExpandingFeature,
  rowPinningFeature,
  createExpandedRowModel,
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  createTableHook,
  filterFn_arrHas,
  filterFn_includesString,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
} from "@tanstack/react-table"

export type DataTableFacetedFilterOption = {
  label: string
  value: string
  icon?: ComponentType<{ className?: string }>
}

export type DataTableColumnMeta = {
  label?: string
  configurable?: boolean
  allowCellOverflow?: boolean
  /** 标量字符串列的多选筛选；组件统一使用 value ∈ selectedValues 的匹配规则。 */
  facetOptions?: readonly DataTableFacetedFilterOption[]
}

export const dataTableFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnPinningFeature,
  columnOrderingFeature,
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowPinningFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    arrHas: filterFn_arrHas,
  },
  columnFacetingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
  },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
})

export type DataTableFeatures = typeof dataTableFeatures

const { createAppColumnHelper, useAppTable, useTableContext } = createTableHook(
  {
    features: dataTableFeatures,
    globalFilterFn: "includesString",
  }
)

export const createDataTableColumnHelper = createAppColumnHelper
export const useDataTable = useAppTable
export const useDataTableContext = useTableContext
