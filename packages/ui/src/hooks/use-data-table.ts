"use client"

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

export type DataTableColumnMeta = {
  label?: string
  configurable?: boolean
  allowCellOverflow?: boolean
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
