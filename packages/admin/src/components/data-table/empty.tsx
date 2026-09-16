import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@workspace/ui/components/empty"
import { useDataTableContext } from "../../hooks/use-data-table"
import { useDataTablePresentation } from "./presentation"

export function DataTableEmpty({
  empty,
  hasFilters,
  onResetFilters,
}: {
  empty?: ReactNode
  hasFilters: boolean
  onResetFilters: () => void
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext()
  const { status } = useDataTablePresentation()
  if (status === "error") return null
  if (table.getRowCount() > 0) {
    return (
      <Empty role="status">
        <EmptyHeader>
          <EmptyTitle>{t("tableEmptyPage")}</EmptyTitle>
          <EmptyDescription>{t("tableEmptyPageDescription")}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => table.setPageIndex(0)}>
          {t("tableFirstPage")}
        </Button>
      </Empty>
    )
  }
  if (!hasFilters && empty !== undefined)
    return <div role="status">{empty}</div>
  return (
    <Empty role="status">
      <EmptyHeader>
        <EmptyTitle>
          {hasFilters ? t("emptyTitle") : t("tableNoData")}
        </EmptyTitle>
        <EmptyDescription>
          {hasFilters ? t("emptyDescription") : t("tableNoDataDescription")}
        </EmptyDescription>
      </EmptyHeader>
      {hasFilters && (
        <Button variant="outline" onClick={onResetFilters}>
          {t("clearFilters")}
        </Button>
      )}
    </Empty>
  )
}
