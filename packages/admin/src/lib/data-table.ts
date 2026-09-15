"use client"

import { createElement } from "react"
import type { RowData } from "@tanstack/react-table"

import {
  DataTableRowControls,
  DataTableSelectAllCheckbox,
  DataTableSelectRowCheckbox,
} from "../components/data-table"
import { createDataTableColumnHelper } from "../hooks/use-data-table"

export function createDataTableSelectColumn<TData extends RowData>() {
  return createDataTableColumnHelper<TData>().display({
    id: "select",
    size: 48,
    enableResizing: false,
    meta: { label: "Selection", configurable: false },
    header: ({ table }) =>
      createElement(DataTableSelectAllCheckbox<TData>, { table }),
    cell: ({ row }) =>
      createElement(DataTableSelectRowCheckbox<TData>, { row }),
    enableSorting: false,
    enableHiding: false,
    enableGlobalFilter: false,
  })
}

export function createDataTableRowControlsColumn<TData extends RowData>() {
  return createDataTableColumnHelper<TData>().display({
    id: "row-controls",
    header: () =>
      createElement("span", { className: "sr-only" }, "Row controls"),
    cell: ({ row }) => createElement(DataTableRowControls<TData>, { row }),
    size: 88,
    enableResizing: false,
    enableHiding: false,
    meta: {
      label: "Row controls",
      configurable: false,
      allowCellOverflow: true,
    },
  })
}
