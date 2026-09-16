"use client"

import { Subscribe, type Header, type RowData } from "@tanstack/react-table"
import { cn } from "cn"
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { DataTableFeatures } from "../../hooks/use-data-table"
import { useDataTablePresentation } from "./presentation"

export function DataTableColumnHeader<TData extends RowData, TValue = unknown>({
  header,
  title,
  className,
}: {
  header: Header<DataTableFeatures, TData, TValue>
  title: string
  className?: string
}) {
  const { isActionPending } = useDataTablePresentation()
  if (!header.column.getCanSort()) {
    return <div className={cn("font-medium", className)}>{title}</div>
  }

  return (
    <Subscribe
      source={header.table.atoms.sorting}
      selector={(sorting) =>
        sorting.find((sort) => sort.id === header.column.id)?.desc
      }
    >
      {(desc) => (
        <Button
          disabled={isActionPending}
          variant="ghost"
          size="sm"
          className={cn("-ms-3", className)}
          onClick={header.column.getToggleSortingHandler()}
        >
          {title}
          {desc === true ? (
            <ArrowDownIcon data-icon="inline-end" />
          ) : desc === false ? (
            <ArrowUpIcon data-icon="inline-end" />
          ) : (
            <ChevronsUpDownIcon data-icon="inline-end" />
          )}
        </Button>
      )}
    </Subscribe>
  )
}
