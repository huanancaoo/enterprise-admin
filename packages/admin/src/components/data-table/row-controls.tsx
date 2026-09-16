"use client"

import { useTranslation } from "react-i18next"
import type { Row, RowData } from "@tanstack/react-table"
import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  ChevronRightIcon,
  Settings2Icon,
  PinOffIcon,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { DataTableFeatures } from "../../hooks/use-data-table"
import { useDataTablePresentation } from "./presentation"

export function DataTableRowControls<TData extends RowData>({
  row,
}: {
  row: Row<DataTableFeatures, TData>
}) {
  const { t } = useTranslation("common")
  const { rowsDisabled } = useDataTablePresentation()
  return (
    <div className="flex items-center gap-1">
      {row.getCanExpand() ? (
        <Button
          disabled={rowsDisabled}
          size="icon-sm"
          variant="ghost"
          aria-label={row.getIsExpanded() ? t("collapseRow") : t("expandRow")}
          aria-expanded={row.getIsExpanded()}
          onClick={() => row.toggleExpanded()}
        >
          <ChevronRightIcon
            className={row.getIsExpanded() ? "rotate-90" : "rtl:rotate-180"}
          />
        </Button>
      ) : null}
      {row.getCanPin() ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                disabled={rowsDisabled}
                size="icon-sm"
                variant="ghost"
                aria-label={t("pinRow")}
              />
            }
          >
            <Settings2Icon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={rowsDisabled}
              onClick={() => row.pin("top")}
            >
              <ArrowUpToLineIcon />
              {t("pinTop")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={rowsDisabled}
              onClick={() => row.pin("bottom")}
            >
              <ArrowDownToLineIcon />
              {t("pinBottom")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={rowsDisabled || !row.getIsPinned()}
              onClick={() => row.pin(false)}
            >
              <PinOffIcon />
              {t("unpinRow")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
