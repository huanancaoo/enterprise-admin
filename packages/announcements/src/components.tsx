import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useUiLocale } from "@workspace/i18n/react"
import { createFormatter } from "@workspace/i18n"
import { Bell } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { DataTable } from "@workspace/admin/data-table"
import { createDataTableColumnHelper } from "@workspace/admin/data-table"
import type { DataTableStatus } from "@workspace/admin/data-table"
import { RichTextEditor } from "@workspace/admin/rich-text-editor"
import type { FileContentPorts } from "@workspace/admin/rich-text-editor"

export type { AnnouncementReading } from "@workspace/contracts/platform-announcements"
import type {
  AnnouncementReading,
  AnnouncementDetail,
  AnnouncementInboxQuery,
} from "@workspace/contracts/platform-announcements"
export type AnnouncementInboxSearch = AnnouncementInboxQuery
export type AnnouncementInboxItem = Pick<
  AnnouncementReading,
  "id" | "title" | "publicationId" | "publishedAt" | "unread"
>
export type AnnouncementAttachment = AnnouncementReading["attachments"][number]
const helper = createDataTableColumnHelper<AnnouncementInboxItem>()

export function AnnouncementEntry({
  unreadCount,
  onOpen,
  error,
}: {
  unreadCount: number | undefined
  onOpen: () => void
  error?: boolean
}) {
  const { t } = useTranslation("announcements")
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onOpen}
      aria-label={t("openInbox")}
      className="relative"
    >
      <Bell className="size-4" />
      {unreadCount !== undefined && unreadCount > 0 && (
        <span
          className="absolute -end-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
          aria-label={t("unreadCount", { quantity: unreadCount })}
        >
          {unreadCount}
        </span>
      )}
      {error && (
        <span className="absolute end-0 top-0 size-1.5 rounded-full bg-destructive" />
      )}
    </Button>
  )
}

export function AnnouncementInbox({
  items,
  total,
  search,
  onSearchChange,
  onOpen,
  status,
  error,
  onRetry,
}: {
  items: AnnouncementInboxItem[]
  total: number
  search: AnnouncementInboxSearch
  onSearchChange: (next: AnnouncementInboxSearch) => void
  onOpen: (item: AnnouncementInboxItem) => void
  status: DataTableStatus
  error?: string
  onRetry: () => void
}) {
  const { t } = useTranslation(["announcements", "common"])
  const locale = useUiLocale()
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("title", {
          header: t("subject"),
          cell: ({ row, getValue }) => (
            <Button
              variant="link"
              className="h-auto max-w-full justify-start p-0 text-start whitespace-normal"
              onClick={() => onOpen(row.original)}
            >
              {getValue()}
            </Button>
          ),
          meta: { label: t("subject") },
          size: 440,
        }),
        helper.accessor("unread", {
          header: t("status"),
          cell: ({ getValue }) => (
            <Badge variant={getValue() ? "secondary" : "outline"}>
              {getValue() ? t("unread") : t("read")}
            </Badge>
          ),
          meta: { label: t("status") },
          size: 120,
        }),
        helper.accessor("publishedAt", {
          header: t("publishedAt"),
          cell: ({ getValue }) =>
            createFormatter(locale).dateTime(new Date(getValue()!), "UTC"),
          meta: { label: t("publishedAt") },
          size: 190,
        }),
      ]),
    [locale, onOpen, t]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  return (
    <section className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">{t("inbox")}</h1>
        <p className="text-sm text-muted-foreground">{t("inboxDescription")}</p>
      </header>
      <DataTable
        columns={columns}
        data={items}
        rowCount={total}
        status={status}
        error={error}
        onRetry={onRetry}
        getRowId={(item) => item.id}
        empty={<p>{t("noAnnouncements")}</p>}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        state={{
          pagination,
          globalFilter: search.q ?? "",
          columnFilters:
            search.unreadOnly === "true" ? [{ id: "unread", value: true }] : [],
        }}
        searchPlaceholder={t("search")}
        searchMaxLength={200}
        toolbarFilters={
          <Field className="w-44 gap-1">
            <FieldLabel
              className="text-xs text-muted-foreground"
              htmlFor="announcement-read-filter"
            >
              {t("status")}
            </FieldLabel>
            <Select
              value={search.unreadOnly === "true" ? "unread" : "all"}
              items={{
                all: t("allReadStates"),
                unread: t("unread"),
              }}
              onValueChange={(value) =>
                onSearchChange({
                  ...search,
                  page: 1,
                  unreadOnly: value === "unread" ? "true" : undefined,
                })
              }
            >
              <SelectTrigger id="announcement-read-filter" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allReadStates")}</SelectItem>

                <SelectItem value="unread">{t("unread")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          onSearchChange({ ...search, q: q || undefined, page: 1 })
        }}
        onResetFilters={() =>
          onSearchChange({ page: 1, pageSize: search.pageSize })
        }
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          onSearchChange({
            ...search,
            page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
            pageSize: next.pageSize,
          })
        }}
      />
    </section>
  )
}

export function AnnouncementArticle({
  item,
  ports,
  onBack,
  onMarkRead,
  markingRead,
  unread,
  readError,
  actions,
}: {
  item: Pick<
    AnnouncementDetail,
    | "id"
    | "title"
    | "content"
    | "attachments"
    | "publicationId"
    | "publishedAt"
    | "updatedAt"
  >
  ports: FileContentPorts
  onBack: () => void
  onMarkRead?: () => void
  markingRead?: boolean
  unread?: boolean
  readError?: string
  actions?: ReactNode
}) {
  const { t } = useTranslation(["announcements", "common"])
  const locale = useUiLocale()
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  useEffect(() => {
    // 已读属于具体发布批次；读取正文成功后才记录，失败保留重试入口。
    if (unread && onMarkRead) onMarkRead()
  }, [item.publicationId, unread, onMarkRead])
  return (
    <article className="mx-auto w-full max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={onBack}>
          {t("back")}
        </Button>
        {actions}
      </div>
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold break-words">
          {item.title}
        </h1>
        <p className="text-xs text-muted-foreground">
          {item.publishedAt
            ? t("publishedDate", {
                date: createFormatter(locale).dateTime(
                  new Date(item.publishedAt),
                  "UTC"
                ),
              })
            : t("updatedDate", {
                date: createFormatter(locale).dateTime(
                  new Date(item.updatedAt),
                  "UTC"
                ),
              })}
        </p>
      </header>
      <RichTextEditor
        variant="document"
        value={item.content}
        editable={false}
        className="rounded-xl border-0 bg-transparent [&_.tiptap]:px-0 [&_.tiptap]:py-0"
        {...ports}
      />
      {item.attachments.length > 0 && (
        <section className="space-y-2 border-t pt-4">
          <h2 className="text-sm font-medium">{t("attachments")}</h2>
          <ul className="space-y-1">
            {item.attachments.map((file) => (
              <li key={file.fileId}>
                <Button
                  variant="link"
                  className="h-auto max-w-full px-0 text-start whitespace-normal"
                  onClick={() => {
                    setAttachmentError(null)
                    void ports
                      .downloadFile(file)
                      .catch((error: unknown) =>
                        setAttachmentError(ports.getFileErrorMessage(error))
                      )
                  }}
                  aria-label={`${t("downloadAttachment")}: ${file.name}`}
                >
                  {file.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {attachmentError && (
        <p role="alert" className="text-sm text-destructive">
          {attachmentError}
        </p>
      )}
      {readError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          <p>{readError}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={markingRead}
            onClick={onMarkRead}
          >
            {t("markRead")}
          </Button>
        </div>
      )}
    </article>
  )
}
