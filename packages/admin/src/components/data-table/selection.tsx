"use client"

import { useTranslation } from "react-i18next"
import { useUiLocale } from "@workspace/i18n/react"
import { createFormatter } from "@workspace/i18n"
import {
  Subscribe,
  type Row,
  type RowData,
  type Table as TanStackTable,
} from "@tanstack/react-table"
import { XIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  useDataTableContext,
  type DataTableFeatures,
} from "../../hooks/use-data-table"
import type { DataTableProps } from "./types"
import { useDataTablePresentation } from "./presentation"

export function DataTableSelectionActions<TData extends RowData>({
  renderActions,
}: {
  renderActions?: DataTableProps<TData>["renderSelectionActions"]
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext<TData>()
  const { isActionPending } = useDataTablePresentation()
  const locale = useUiLocale()

  return (
    <Subscribe source={table.atoms.rowSelection}>
      {() => {
        const rows = table.getFilteredSelectedRowModel().rows
        if (rows.length === 0) return null

        return (
          <div
            data-slot="data-table-selection-actions"
            role="region"
            aria-label={t("selectionActions")}
            className="flex flex-wrap items-center gap-2"
          >
            <span role="status" className="text-sm font-medium">
              {t("selectedRows", {
                total: createFormatter(locale).number(rows.length),
              })}
            </span>
            <Button
              disabled={isActionPending}
              variant="outline"
              size="sm"
              onClick={() => table.resetRowSelection(true)}
            >
              <XIcon data-icon="inline-start" aria-hidden="true" />
              {t("clearSelection")}
            </Button>
            {renderActions ? (
              <div className="flex flex-wrap items-center gap-2 border-s ps-2">
                {renderActions(rows)}
              </div>
            ) : null}
          </div>
        )
      }}
    </Subscribe>
  )
}

export function DataTableSelectAllCheckbox<TData extends RowData>({
  table,
}: {
  table: TanStackTable<DataTableFeatures, TData>
}) {
  const { t } = useTranslation("common")
  const { rowsDisabled } = useDataTablePresentation()
  return (
    <Subscribe source={table.atoms.rowSelection}>
      {() => {
        const allSelected = table.getIsAllPageRowsSelected()
        const someSelected = table.getIsSomePageRowsSelected()

        return (
          <Checkbox
            disabled={
              rowsDisabled ||
              !table.getRowModel().rows.some((row) => row.getCanSelect())
            }
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            aria-label={t("tableSelectPage")}
            onCheckedChange={(_checked, details) => {
              table.getToggleAllPageRowsSelectedHandler()(details.event)
            }}
          />
        )
      }}
    </Subscribe>
  )
}

export function DataTableSelectRowCheckbox<TData extends RowData>({
  row,
}: {
  row: Row<DataTableFeatures, TData>
}) {
  const { t } = useTranslation("common")
  const { rowsDisabled } = useDataTablePresentation()
  return (
    <Subscribe
      source={row.table.atoms.rowSelection}
      selector={(selection) => selection[row.id]}
    >
      {(selected) => (
        <Checkbox
          checked={!!selected}
          disabled={rowsDisabled || !row.getCanSelect()}
          aria-label={t("selectRow")}
          onCheckedChange={(_checked, details) => {
            row.getToggleSelectedHandler()(details.event)
          }}
        />
      )}
    </Subscribe>
  )
}
