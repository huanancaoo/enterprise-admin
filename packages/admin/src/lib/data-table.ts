"use client"

import { createElement } from "react"
import type { RowData } from "@tanstack/react-table"

import {
  DataTableSelectAllCheckbox,
  DataTableSelectRowCheckbox,
} from "../components/data-table/selection"
import { DataTableRowControls } from "../components/data-table/row-controls"
import { createDataTableColumnHelper } from "../hooks/use-data-table"

export function createDataTableSelectColumn<TData extends RowData>() {
  return createDataTableColumnHelper<TData>().display({
    id: "select",
    size: 48,
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
    enableHiding: false,
    meta: {
      label: "Row controls",
      configurable: false,
      allowCellOverflow: true,
    },
  })
}
