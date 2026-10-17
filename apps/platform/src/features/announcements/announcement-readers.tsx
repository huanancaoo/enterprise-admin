import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { z } from "zod"
import type { AnnouncementReadersPageSchema } from "@workspace/contracts/platform-announcements"
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"

type Reader = z.infer<typeof AnnouncementReadersPageSchema>["items"][number]
const helper = createDataTableColumnHelper<Reader>()
export function AnnouncementReaders({
  title,
  items,
  total,
  page,
  pageSize,
  onPageChange,
  onBack,
  status,
  error,
  onRetry,
}: {
  title: string
  items: Reader[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number, pageSize: number) => void
  onBack: () => void
  status: DataTableStatus
  error?: string
  onRetry: () => void
}) {
  const { t } = useTranslation("announcements")
  const locale = useUiLocale()
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: t("reader"),
          cell: ({ row, getValue }) => (
            <div className="min-w-0">
              <p className="truncate font-medium">{getValue() ?? "—"}</p>
              <bdi className="text-xs text-muted-foreground">
                {row.original.maskedEmail}
              </bdi>
            </div>
          ),
          size: 320,
          meta: { label: t("reader") },
        }),
        helper.accessor("readAt", {
          header: t("readAt"),
          cell: ({ getValue }) =>
            createFormatter(locale).dateTime(new Date(getValue()), "UTC"),
          size: 200,
          meta: { label: t("readAt") },
        }),
      ]),
    [locale, t]
  )
  const pagination = { pageIndex: page - 1, pageSize }
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold">
            {t("readers")}
          </h1>
          <p className="text-sm break-words text-muted-foreground">{title}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onBack}>
          {t("back")}
        </Button>
      </header>
      <DataTable
        columns={columns}
        data={items}
        rowCount={total}
        getRowId={(item) => item.userId}
        status={status}
        error={error}
        onRetry={onRetry}
        empty={<p>{t("noReaders")}</p>}
        manualPagination
        enableSorting={false}
        enableRowSelection={false}
        showSearch={false}
        state={{ pagination }}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          onPageChange(
            next.pageSize === pageSize ? next.pageIndex + 1 : 1,
            next.pageSize
          )
        }}
      />
    </section>
  )
}
