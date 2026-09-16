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
  filterFn_equalsString,
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
  /** 筛选值是单个标量还是多选集合，决定筛选组件与本地筛选函数的语义。 */
  facetMode?: "single" | "multiple"
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
    equalsString: filterFn_equalsString,
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
