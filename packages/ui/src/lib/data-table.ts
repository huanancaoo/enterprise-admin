"use client"

import { createElement } from "react"
import type { RowData } from "@tanstack/react-table"

import {
  DataTableSelectAllCheckbox,
  DataTableSelectRowCheckbox,
} from "@workspace/ui/components/data-table"
import { createDataTableColumnHelper } from "@workspace/ui/hooks/use-data-table"

export function createDataTableSelectColumn<TData extends RowData>() {
  return createDataTableColumnHelper<TData>().display({
    id: "select",
    header: ({ table }) =>
      createElement(DataTableSelectAllCheckbox<TData>, { table }),
    cell: ({ row }) =>
      createElement(DataTableSelectRowCheckbox<TData>, { row }),
    enableSorting: false,
    enableHiding: false,
    enableGlobalFilter: false,
  })
}
